"""Pronóstico univariado a 12 meses. Dos métodos con la misma salida:

  holt    Holt con tendencia amortiguada (solo numpy, instantáneo)
  bilstm  Bi-LSTM en PyTorch (ver app/bilstm.py)

Ambos devuelven pronóstico, IC95 empírico, RMSE por horizonte y validación 2025,
por lo que train.py, model.pkl, la API y el frontend no cambian al cambiar de método.
"""
import numpy as np

GRID = [(a, b, p) for a in (0.2, 0.5, 0.8) for b in (0.05, 0.15, 0.3) for p in (0.85, 0.95, 0.99)]
HORIZONS = (3, 6, 12)
MODEL_NAMES = {"holt": "Holt con tendencia amortiguada", "bilstm": "Bi-LSTM univariado"}


# ── utilidades comunes ────────────────────────────────────────────────────────
def _pack(fc, rmse_h, val):
    sd = np.interp(np.arange(1, 13), [0, 3, 6, 12], [0, rmse_h[3], rmse_h[6], rmse_h[12]])
    return {"forecast": fc, "lo": fc - 1.96 * sd, "hi": fc + 1.96 * sd, "rmse_h": rmse_h, "validation": val}


def _validation(y_true, y_pred):
    err = np.asarray(y_true) - np.asarray(y_pred)
    return {"rmse": float(np.sqrt(np.mean(err ** 2))), "mae": float(np.mean(np.abs(err)))}


def make_windows(z, lookback, horizon):
    """Ventanas (X: últimos `lookback` meses, Y: siguientes `horizon` meses relativos al último)."""
    X, Y = [], []
    for t in range(lookback, len(z) - horizon + 1):
        X.append(z[t - lookback:t])
        Y.append(z[t:t + horizon] - z[t - 1])
    return np.asarray(X), np.asarray(Y)


# ── Holt amortiguado ──────────────────────────────────────────────────────────
def _run(y, a, b, phi, h):
    l, t, sse = y[0], y[1] - y[0], 0.0
    for v in y[1:]:
        f = l + phi * t
        sse += (v - f) ** 2
        ln = a * v + (1 - a) * f
        t = b * (ln - l) + (1 - b) * phi * t
        l = ln
    steps = np.cumsum(phi ** np.arange(1, h + 1))
    return sse, l + steps * t


def fit_forecast(y, h=12):
    return min((_run(y, a, b, p, h) for a, b, p in GRID), key=lambda r: r[0])[1]


def forecast_bundle(y):
    """Holt: validación cerrada (hasta dic-2024 → 2025) y backtest de origen rodante."""
    y = np.asarray(y, float)
    n = len(y)
    cut = n - 16  # los últimos 16 meses: 2025 completo + ene-abr 2026
    val = _validation(y[cut:cut + 12], fit_forecast(y[:cut], 12))
    errs = {h: [] for h in HORIZONS}
    for o in range(n - 12 - 48, n - 12 + 1, 4):
        pr = fit_forecast(y[:o], 12)
        for h in HORIZONS:
            errs[h].append(y[o + h - 1] - pr[h - 1])
    rmse_h = {h: float(np.sqrt(np.mean(np.square(errs[h])))) for h in HORIZONS}
    return _pack(fit_forecast(y, 12), rmse_h, val)


# ── Métodos entrenables (Bi-LSTM) ─────────────────────────────────────────────
def window_bundle(y, fit):
    """`fit(y_train)` devuelve `predict(y_hist) -> 12 meses`.

    1) Validación 2025: entrena con datos hasta dic-2024 y pronostica 2025.
    2) Error por horizonte: entrena con datos hasta 28 meses antes del final y evalúa
       mes a mes (todo fuera de muestra) para h = 3, 6 y 12.
    3) Pronóstico final: entrena con toda la serie.
    """
    y = np.asarray(y, float)
    n = len(y)
    if n < 80:  # serie demasiado corta para una red: usa Holt
        return forecast_bundle(y)
    cut = n - 16
    val = _validation(y[cut:cut + 12], fit(y[:cut])(y[:cut]))
    bt = n - 28
    predictor = fit(y[:bt])
    errs = {h: [] for h in HORIZONS}
    for o in range(bt, n - 12 + 1):
        pr = predictor(y[:o])
        for h in HORIZONS:
            errs[h].append(y[o + h - 1] - pr[h - 1])
    rmse_h = {h: float(np.sqrt(np.mean(np.square(errs[h])))) for h in HORIZONS}
    return _pack(np.asarray(fit(y)(y), float), rmse_h, val)


def get_bundle_fn(name, **kwargs):
    if name == "holt":
        return forecast_bundle
    if name == "bilstm":
        from app.bilstm import bilstm_factory  # importa torch solo si se pide
        fit = bilstm_factory(**kwargs)
        return lambda y: window_bundle(y, fit)
    raise ValueError(f"Método desconocido: {name}")
