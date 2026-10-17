"""Bi-LSTM univariado (PyTorch) para pronosticar 12 meses de la serie de precios.

Por serie (entidad × canal):
  1. Normaliza con media/desviación del tramo de entrenamiento.
  2. Ventanas de 24 meses -> predice directamente los 12 meses siguientes
     (como diferencias respecto al último valor de la ventana; sin recursividad).
  3. Bi-LSTM -> concatena el estado final hacia adelante y hacia atrás -> capa densa -> 12 salidas.
  4. Adam + recorte de gradiente + parada temprana con las ventanas más recientes
     (con un hueco de 12 meses entre entrenamiento y validación).
"""
import copy

import numpy as np
import torch
import torch.nn as nn

from app.forecasting import make_windows


class _Net(nn.Module):
    def __init__(self, hidden, horizon):
        super().__init__()
        self.lstm = nn.LSTM(input_size=1, hidden_size=hidden, batch_first=True, bidirectional=True)
        self.head = nn.Sequential(nn.Linear(2 * hidden, 64), nn.ReLU(), nn.Dropout(0.1), nn.Linear(64, horizon))

    def forward(self, x):                      # x: (batch, lookback, 1)
        _, (h, _) = self.lstm(x)               # h: (2, batch, hidden) -> [adelante, atrás]
        return self.head(torch.cat([h[0], h[1]], dim=1))


class BiLSTMForecaster:
    def __init__(self, lookback=24, horizon=12, hidden=32, epochs=300, lr=5e-3, patience=40, seed=42):
        self.lookback, self.horizon, self.hidden = lookback, horizon, hidden
        self.epochs, self.lr, self.patience, self.seed = epochs, lr, patience, seed

    def fit(self, y):
        y = np.asarray(y, np.float32)
        self.mu, self.sd = float(y.mean()), float(y.std()) or 1.0
        z = (y - self.mu) / self.sd
        X, Y = make_windows(z, self.lookback, self.horizon)
        nval = max(8, len(X) // 8)
        gap = self.horizon
        tr = slice(0, len(X) - nval - gap)
        va = slice(len(X) - nval, len(X))
        t = lambda a: torch.from_numpy(np.ascontiguousarray(a, dtype=np.float32))
        Xtr, Ytr, Xva, Yva = t(X[tr]).unsqueeze(-1), t(Y[tr]), t(X[va]).unsqueeze(-1), t(Y[va])

        torch.manual_seed(self.seed)
        net = _Net(self.hidden, self.horizon)
        opt = torch.optim.Adam(net.parameters(), lr=self.lr, weight_decay=1e-5)
        loss_fn = nn.MSELoss()
        best, best_state, wait = float("inf"), None, 0
        for _ in range(self.epochs):
            net.train()
            opt.zero_grad()
            loss_fn(net(Xtr), Ytr).backward()
            nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()
            net.eval()
            with torch.no_grad():
                v = loss_fn(net(Xva), Yva).item()
            if v < best - 1e-6:
                best, best_state, wait = v, copy.deepcopy(net.state_dict()), 0
            else:
                wait += 1
                if wait >= self.patience:
                    break
        net.load_state_dict(best_state)
        self.net = net.eval()
        return self

    def predict(self, y):
        z = (np.asarray(y, np.float32)[-self.lookback:] - self.mu) / self.sd
        x = torch.from_numpy(np.ascontiguousarray(z)).view(1, -1, 1)
        with torch.no_grad():
            delta = self.net(x)[0].numpy()
        return ((z[-1] + delta) * self.sd + self.mu).astype(float)


def bilstm_factory(**kwargs):
    """fit(y_train) -> predict(y_hist), la interfaz que espera window_bundle."""
    return lambda y: BiLSTMForecaster(**kwargs).fit(y).predict
