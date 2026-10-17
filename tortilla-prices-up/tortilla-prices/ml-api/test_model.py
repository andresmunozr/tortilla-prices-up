import pickle
from pathlib import Path

MODEL_PATH = Path(__file__).resolve().parent / "model" / "model.pkl"

with open(MODEL_PATH, "rb") as model_file:
    model_data = pickle.load(model_file)

# Entidades válidas: ver model_data["states"] (o "ALL" para el nacional)
STATE, CHANNEL = "Jalisco", "all"  # canal: all, mom_pop, big_retail

f = model_data["forecasts"][f"{STATE}|{CHANNEL}"]
print(f"{f['name']} — último dato {f['last_date']}: ${f['last_value']:.2f}/kg")
for h, v in f["horizons"].items():
    print(f"  +{h:>2} meses ({v['label']}): ${v['v']:.2f}  IC95 [{v['lo']:.2f}, {v['hi']:.2f}]  RMSE ±{v['rmse']:.2f}")
print("Validación 2025:", f["validation"])
