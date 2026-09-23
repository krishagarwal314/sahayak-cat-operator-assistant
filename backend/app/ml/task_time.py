"""Task time model: how long will this job take?

The brief asks for a prediction "based on past data and environmental
conditions", so the model learns from completed jobs, using the job itself
(type, machine, size), the conditions (weather, ground, shift, temperature)
and the operator (skill on that machine).

Gradient boosting on minutes-per-unit, plus two quantile models at the 10th
and 90th percentile, so every prediction comes with an honest range rather
than a single number to argue with.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from ..config import BACKEND_DIR

MODEL_PATH = BACKEND_DIR / "models" / "ml" / "task_time.joblib"
METRICS_PATH = BACKEND_DIR / "models" / "ml" / "task_time_metrics.json"

CATEGORICAL = ["task_type", "machine_family", "weather", "ground", "shift"]
NUMERIC = ["ambient_temp_c", "operator_skill", "log_units"]
_CACHE: dict = {}


def _frame(rows: list[dict]):
    import pandas as pd

    df = pd.DataFrame(rows)
    df["log_units"] = df["units"].astype(float).clip(lower=1).map(math.log)
    return df[CATEGORICAL + NUMERIC]


def _pipeline(loss: str, alpha: float | None = None):
    from sklearn.compose import ColumnTransformer
    from sklearn.ensemble import GradientBoostingRegressor
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder

    params = {"n_estimators": 300, "max_depth": 3, "learning_rate": 0.05, "subsample": 0.9, "random_state": 7}
    if alpha is not None:
        params["alpha"] = alpha
    return Pipeline([
        ("features", ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL)],
                                       remainder="passthrough")),
        ("model", GradientBoostingRegressor(loss=loss, **params)),
    ])


def train(rows: list[dict], seed: int = 7) -> dict:
    """Fit on 80% of jobs, measure on the other 20%, then refit on everything."""
    import joblib
    import numpy as np

    rng = np.random.default_rng(seed)
    order = rng.permutation(len(rows))
    cut = int(len(rows) * 0.8)
    train_rows = [rows[i] for i in order[:cut]]
    test_rows = [rows[i] for i in order[cut:]]

    def rates(rs):
        return np.array([r["actual_minutes"] / max(1, r["units"]) for r in rs])

    def units(rs):
        return np.array([max(1, r["units"]) for r in rs], dtype=float)

    median = _pipeline("absolute_error").fit(_frame(train_rows), rates(train_rows))
    low = _pipeline("quantile", 0.07).fit(_frame(train_rows), rates(train_rows))
    high = _pipeline("quantile", 0.93).fit(_frame(train_rows), rates(train_rows))

    actual = np.array([r["actual_minutes"] for r in test_rows])
    pred = median.predict(_frame(test_rows)) * units(test_rows)
    lo = low.predict(_frame(test_rows)) * units(test_rows)
    hi = high.predict(_frame(test_rows)) * units(test_rows)

    # Baseline: the typical pace for that job type, ignoring conditions and operator.
    by_type: dict[str, list[float]] = {}
    for r in train_rows:
        by_type.setdefault(r["task_type"], []).append(r["actual_minutes"] / max(1, r["units"]))
    base = np.array([np.median(by_type.get(r["task_type"], [0])) for r in test_rows]) * units(test_rows)

    mae = float(np.mean(np.abs(pred - actual)))
    base_mae = float(np.mean(np.abs(base - actual)))
    metrics = {
        "model": "gradient boosting, minutes per unit, with 7th/93rd percentile models",
        "trained_on_jobs": len(rows), "test_jobs": len(test_rows),
        "mae_minutes": round(mae, 1),
        "mape_pct": round(float(np.mean(np.abs(pred - actual) / actual)) * 100, 1),
        "baseline_mae_minutes": round(base_mae, 1),
        "improvement_vs_baseline_pct": round((1 - mae / base_mae) * 100, 1),
        "range_coverage_pct": round(float(np.mean((actual >= lo) & (actual <= hi))) * 100, 1),
        "baseline": "median pace per job type, ignoring conditions and operator",
    }

    # Refit on every job for the model that ships.
    final = {
        "median": _pipeline("absolute_error").fit(_frame(rows), rates(rows)),
        "low": _pipeline("quantile", 0.07).fit(_frame(rows), rates(rows)),
        "high": _pipeline("quantile", 0.93).fit(_frame(rows), rates(rows)),
    }
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(final, MODEL_PATH)
    METRICS_PATH.write_text(json.dumps(metrics, indent=1))
    _CACHE.clear()
    return metrics


def available() -> bool:
    return _load() is not None


def _load():
    if "model" in _CACHE:
        return _CACHE["model"]
    if not MODEL_PATH.exists():
        return None
    try:
        import joblib

        _CACHE["model"] = joblib.load(MODEL_PATH)
    except Exception:  # noqa: BLE001 - a broken file must not break estimates
        _CACHE["model"] = None
    return _CACHE["model"]


def predict(features: dict) -> dict | None:
    """features: task_type, machine_family, weather, ground, shift,
    ambient_temp_c, operator_skill, units. Returns minutes with a range."""
    models = _load()
    if models is None:
        return None
    frame = _frame([features])
    u = max(1.0, float(features["units"]))
    mid = float(models["median"].predict(frame)[0]) * u
    lo = float(models["low"].predict(frame)[0]) * u
    hi = float(models["high"].predict(frame)[0]) * u
    lo, hi = min(lo, mid), max(hi, mid)
    return {"expected": mid, "low": lo, "high": hi}


def metrics() -> dict | None:
    return json.loads(METRICS_PATH.read_text()) if METRICS_PATH.exists() else None
