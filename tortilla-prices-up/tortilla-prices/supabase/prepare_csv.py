"""Convierte ml-api/data/tortilla_prices.csv al formato de la tabla (snake_case + id).

Uso:  python supabase/prepare_csv.py
Luego: Supabase → Table Editor → tortilla_prices → Import data from CSV
(si el panel limita el tamaño, divide el archivo o impórtalo con psql \copy).
"""
from pathlib import Path
import pandas as pd

root = Path(__file__).resolve().parents[1]
df = pd.read_csv(root / "ml-api" / "data" / "tortilla_prices.csv")
for c in ("State", "City", "Store type"):
    df[c] = df[c].str.replace("\u00a0", " ", regex=False).str.strip()
df.columns = ["state", "city", "year", "month", "day", "store_type", "price_per_kilogram"]
df.insert(0, "id", range(1, len(df) + 1))
out = Path(__file__).resolve().parent / "tortilla_prices_supabase.csv"
df.to_csv(out, index=False)
print(f"{len(df)} filas -> {out}")
