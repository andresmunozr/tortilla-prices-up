import pickle
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException

MODEL_PATH = Path(__file__).resolve().parents[2] / "model" / "model.pkl"

with open(MODEL_PATH, "rb") as model_file:
    model_data = pickle.load(model_file)

VALID_STATES = {s["value"] for s in model_data["states"]} | {"ALL"}

router = APIRouter()


def check_state(state: str):
    if state not in VALID_STATES:
        raise HTTPException(status_code=404, detail=f"Entidad desconocida: {state}")


@router.get("/summary")
def summary():
    d = model_data
    return {k: d[k] for k in ("meta", "states", "kpis", "ranking", "channel_table")}


@router.get("/forecast")
def forecast(state: str = "ALL", channel: Literal["all", "mom_pop", "big_retail"] = "all"):
    check_state(state)
    return model_data["forecasts"][f"{state}|{channel}"]


@router.get("/channels")
def channels(state: str = "ALL"):
    check_state(state)
    return model_data["channel_series"][state]
