"""Entrena (ajusta) los pronósticos y precalcula todas las agregaciones del tablero.

Equivalente a ml-api/train.py del repo students: lee data/*.csv y guarda model/model.pkl,
que luego carga la API al arrancar. Solo contiene tipos nativos de Python (dict/list/float).
"""
import argparse
import pickle
from pathlib import Path

import numpy as np
import pandas as pd

from app.forecasting import HORIZONS, MODEL_NAMES, get_bundle_fn

parser = argparse.ArgumentParser(description="Entrena los pronósticos y guarda model/model.pkl")
parser.add_argument("--model", choices=list(MODEL_NAMES), default="bilstm",
                    help="bilstm (requiere torch, ver requirements-train.txt) o holt (solo numpy)")
parser.add_argument("--epochs", type=int, default=300, help="épocas máximas del Bi-LSTM")
args = parser.parse_args()
bundle_fn = get_bundle_fn(args.model, epochs=args.epochs) if args.model == "bilstm" else get_bundle_fn("holt")
print(f"Modelo: {MODEL_NAMES[args.model]}")

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_PATH = SCRIPT_DIR / "data" / "tortilla_prices.csv"
MODEL_DIR = SCRIPT_DIR / "model"
MODEL_PATH = MODEL_DIR / "model.pkl"

STORE = {"mom_pop": "Mom and Pop Store", "big_retail": "Big Retail Store"}
CHANNELS = ("all", "mom_pop", "big_retail")
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
DISPLAY = {"D.F.": "D.F. (Ciudad de México)", "ALL": "Nacional ponderado"}

raw = pd.read_csv(DATA_PATH).rename(columns={"Store type": "Store", "Price per kilogram": "P"})
for c in ("State", "City", "Store"):  # el CSV trae espacios no separables (\xa0)
    raw[c] = raw[c].str.replace("\u00a0", " ", regex=False).str.strip()
print(f"Dataset cargado: {len(raw)} filas, {len(raw.columns)} columnas")

valid = raw[raw["P"].notna() & (raw["P"] > 0)]
print(f"Filas con precio válido: {len(valid)} ({len(valid) / len(raw):.1%})")
tab = valid.groupby(["State", "Store", "Year", "Month"])["P"].agg(["sum", "count"]).reset_index()
states = sorted(raw["State"].unique())
name = lambda s: DISPLAY.get(s, s)

_cache = {}


def series(state, channel):
    """Serie mensual. Nacional = promedio simple de entidades. Huecos: interpolación lineal."""
    key = (state, channel)
    if key not in _cache:
        t = tab if channel == "all" else tab[tab["Store"] == STORE[channel]]
        if state != "ALL":
            t = t[t["State"] == state]
        g = t.groupby(["State", "Year", "Month"])[["sum", "count"]].sum()
        m = (g["sum"] / g["count"]).groupby(["Year", "Month"]).mean()
        m.index = pd.PeriodIndex([pd.Period(f"{y}-{mo:02d}", "M") for y, mo in m.index])
        _cache[key] = m.reindex(pd.period_range(m.index.min(), m.index.max(), freq="M")).interpolate()
    return _cache[key]


def year_mean(state, channel, year):
    s = series(state, channel)
    s = s[s.index.year == year]
    return float(s.mean()) if len(s) else None


def coverage(state):
    d = raw[raw["State"] == state]
    c = int(d["City"].nunique())
    return {"cities": c, "rows": int(len(d)), "text": f"{c} ciudad{'es' if c != 1 else ''} ({len(d):,} filas)"}


# ── Pronósticos precalculados (33 entidades × 3 canales) ──────────────────────
forecasts = {}
for s in ["ALL"] + states:
    for ch in CHANNELS:
        ser = series(s, ch)
        b = bundle_fn(ser.values)
        last = ser.index[-1]
        months = []
        for i in range(12):
            p = last + i + 1
            months.append({"date": str(p), "label": f"{MESES[p.month - 1].capitalize()} {p.year}",
                           "v": round(float(b["forecast"][i]), 2),
                           "lo": round(float(b["lo"][i]), 2), "hi": round(float(b["hi"][i]), 2)})
        cur = float(ser.iloc[-1])
        horizons = {str(h): {**months[h - 1], "rmse": round(b["rmse_h"][h], 2),
                             "pct": round((months[h - 1]["v"] / cur - 1) * 100, 1)} for h in HORIZONS}
        forecasts[f"{s}|{ch}"] = {
            "state": s, "name": name(s), "channel": ch,
            "last_date": str(last), "last_value": round(cur, 2),
            "history": {"dates": [str(p) for p in ser.index], "values": [round(float(v), 2) for v in ser.values]},
            "months": months, "horizons": horizons,
            "validation": {k: round(v, 2) for k, v in b["validation"].items()},
        }
    print(f"  pronóstico listo: {s}")

# ── Series por canal (media móvil 12 meses) ───────────────────────────────────
channel_series = {}
for s in ["ALL"] + states:
    df = pd.concat([series(s, "mom_pop"), series(s, "big_retail")], axis=1, keys=["mp", "br"]).dropna()
    roll = df.rolling(12).mean().dropna()
    channel_series[s] = {"name": name(s), "dates": [str(p) for p in roll.index],
                         "mp": [round(float(x), 2) for x in roll["mp"]],
                         "br": [round(float(x), 2) for x in roll["br"]],
                         "corr": round(float(df["mp"].corr(df["br"])), 3)}

# ── Ranking y tabla de brechas (2025) ─────────────────────────────────────────
nat25, nat24 = year_mean("ALL", "all", 2025), year_mean("ALL", "all", 2024)
ranking = []
for s in states:
    p = year_mean(s, "all", 2025)
    ranking.append({"state": s, "name": name(s), "p2025": p, "mean_all": float(series(s, "all").mean()),
                    "gap": (p / nat25 - 1) * 100, "cov": coverage(s)["text"]})
ranking.sort(key=lambda r: -r["p2025"])
lo, hi = ranking[-1]["p2025"], ranking[0]["p2025"]
for i, r in enumerate(ranking):
    r["rank"] = i + 1
    r["bar"] = round((r["p2025"] - lo) / (hi - lo) * 100)
    r["cat"] = "high" if i < 8 else ("low" if i >= len(ranking) - 8 else "mid")

channel_table = []
for s in states:
    mp, br = year_mean(s, "mom_pop", 2025), year_mean(s, "big_retail", 2025)
    channel_table.append({"state": s, "name": name(s), "mp": mp, "br": br, "gap": mp - br,
                          "pct": (mp / br - 1) * 100, "n": int((valid["State"] == s).sum()),
                          "cities": coverage(s)["cities"]})
channel_table.sort(key=lambda r: -r["gap"])
q75, q50 = np.percentile([r["pct"] for r in channel_table], [75, 50])
for r in channel_table:
    r["risk"] = "Alto" if r["pct"] >= q75 else ("Medio" if r["pct"] >= q50 else "Bajo")

# ── KPIs ──────────────────────────────────────────────────────────────────────
mp25, br25 = year_mean("ALL", "mom_pop", 2025), year_mean("ALL", "big_retail", 2025)
n_mp, n_br = int((raw["Store"] == STORE["mom_pop"]).sum()), int((raw["Store"] == STORE["big_retail"]).sum())
last = series("ALL", "all").index[-1]
kpis = {
    "nat25": nat25, "yoy": (nat25 / nat24 - 1) * 100, "pmin": ranking[-1], "pmax": ranking[0],
    "spread": ranking[0]["p2025"] - ranking[-1]["p2025"], "mp": mp25, "br": br25, "gap": mp25 - br25,
    "gap_pct": (mp25 / br25 - 1) * 100, "vs07": (mp25 / year_mean("ALL", "mom_pop", 2007) - 1) * 100,
    "n_mp": n_mp, "n_br": n_br, "p_mp": n_mp / len(raw) * 100, "p_br": n_br / len(raw) * 100,
    "val": forecasts["ALL|all"]["validation"], "corr": channel_series["ALL"]["corr"],
}
meta = {"model": MODEL_NAMES[args.model], "n_obs": int(len(raw)), "n_valid": int(len(valid)),
        "null_pct": (1 - len(valid) / len(raw)) * 100, "n_states": len(states),
        "n_cities": int(raw["City"].nunique()), "y0": int(raw["Year"].min()), "y1": int(raw["Year"].max()),
        "last": f"{MESES[last.month - 1]}-{last.year}", "last_date": str(last)}

model_data = {
    "meta": meta, "states": [{"value": s, "name": name(s)} for s in states], "kpis": kpis,
    "ranking": ranking, "channel_table": channel_table, "forecasts": forecasts,
    "channel_series": channel_series, "horizons": list(HORIZONS),
}

MODEL_DIR.mkdir(parents=True, exist_ok=True)
with open(MODEL_PATH, "wb") as f:
    pickle.dump(model_data, f)

print("\nRMSE validación 2025 (nacional):", kpis["val"])
print(f"[OK] Modelo guardado en {MODEL_PATH}")
print(f"   Tamaño del archivo: {MODEL_PATH.stat().st_size / 1024:.1f} KB")
