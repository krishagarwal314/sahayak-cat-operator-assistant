"""Safety risk model: how likely is a safety alert in the next hour?

Trained on hourly telemetry in the problem statement's own schema - the
"Safety Alert Triggered" column - to predict the NEXT hour from this one. It
looks at the things that actually precede incidents: how long the operator
has worked without a break, heat, idling, whether the belt is off now, and
whether they have already had alerts today.

Tested on days it never saw, not on random hours: hours within a day are
related, so a random split would flatter the score.

Every prediction names its top reasons in plain words, so the warning an
operator hears is "you have been working 4 hours without a break", not a
percentage.
"""

from __future__ import annotations

import csv
import json

from ..config import BACKEND_DIR, settings

MODEL_PATH = BACKEND_DIR / "models" / "ml" / "safety_risk.joblib"
METRICS_PATH = BACKEND_DIR / "models" / "ml" / "safety_risk_metrics.json"

FAMILY = {"EXC001": "excavator", "LDR001": "loader", "DZR001": "dozer"}
CATEGORICAL = ["weather", "machine_family"]
NUMERIC = ["hours_into_shift", "minutes_since_break", "ambient_temp_c", "idle_min", "load_cycles",
           "engine_temp_c", "belt_off", "proximity", "alerts_today"]

# The value each feature takes on a calm, safe hour - used to explain a
# prediction by asking "how much lower would the risk be if this were normal?"
SAFE = {"minutes_since_break": 60, "ambient_temp_c": 30.0, "idle_min": 8, "belt_off": 0,
        "proximity": 0, "alerts_today": 0, "engine_temp_c": 88.0}

REASONS = {
    "minutes_since_break": ("idle", "आप बहुत देर से बिना आराम के काम कर रहे हैं। दस मिनट आराम कीजिए।",
                            "You have worked a long time without a break. Take ten minutes."),
    "ambient_temp_c": ("sun", "बहुत गर्मी है। पानी पीजिए और छाँव में आराम कीजिए।",
                       "It is very hot. Drink water and rest in the shade."),
    "alerts_today": ("alert", "आज पहले भी सुरक्षा चेतावनी आ चुकी है। और सावधान रहिए।",
                     "You have already had safety alerts today. Take extra care."),
    "belt_off": ("seatbelt", "सीट बेल्ट खुली है। अभी लगाइए।", "Your seatbelt is off. Fasten it now."),
    "proximity": ("proximity", "मशीन के पास कोई है। रुककर देखिए।", "Someone is near the machine. Stop and look."),
    "idle_min": ("idle", "मशीन बहुत देर खाली चल रही है।", "The machine has been idling a long time."),
    "engine_temp_c": ("temp", "इंजन गरम है। भार कम कीजिए।", "The engine is hot. Ease off the load."),
}

_CACHE: dict = {}


def _load_rows() -> list[dict]:
    path = settings.seed_dir / "telemetry_history.csv"
    with path.open(encoding="utf-8") as fh:
        return [r for r in csv.DictReader(fh) if r.get("Safety Alert Next Hour")]


def features_from_row(r: dict) -> dict:
    return {
        "weather": r["Weather"], "machine_family": FAMILY.get(r["Machine ID"], "excavator"),
        "hours_into_shift": float(r["Hours Into Shift"]), "minutes_since_break": float(r["Minutes Since Break"]),
        "ambient_temp_c": float(r["Ambient Temp (C)"]), "idle_min": float(r["Idling Time (min)"]),
        "load_cycles": float(r["Load Cycles"]), "engine_temp_c": float(r["Engine Temp (C)"]),
        "belt_off": float(r["Seatbelt Status"] == "Unfastened"), "proximity": float(r["Proximity Event"] == "Yes"),
        "alerts_today": float(r["Alerts So Far Today"]),
    }


def _frame(feats: list[dict]):
    import pandas as pd

    return pd.DataFrame(feats)[CATEGORICAL + NUMERIC]


def _pipeline():
    from sklearn.compose import ColumnTransformer
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder

    return Pipeline([
        ("features", ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL)],
                                       remainder="passthrough")),
        ("model", GradientBoostingClassifier(n_estimators=200, max_depth=2, learning_rate=0.05,
                                             subsample=0.9, random_state=7)),
    ])


def train() -> dict:
    import joblib
    import numpy as np
    from sklearn.metrics import roc_auc_score

    rows = _load_rows()
    days = sorted({r["Timestamp"][:10] for r in rows})
    test_days = set(days[int(len(days) * 0.8):])            # the last fifth, never seen
    train_rows = [r for r in rows if r["Timestamp"][:10] not in test_days]
    test_rows = [r for r in rows if r["Timestamp"][:10] in test_days]

    y = lambda rs: np.array([r["Safety Alert Next Hour"] == "Yes" for r in rs], dtype=int)  # noqa: E731
    X = lambda rs: _frame([features_from_row(r) for r in rs])                              # noqa: E731

    model = _pipeline().fit(X(train_rows), y(train_rows))
    prob = model.predict_proba(X(test_rows))[:, 1]
    actual = y(test_rows)
    auc = float(roc_auc_score(actual, prob))

    # Baseline: "if there is an alert now, there will be one next hour".
    now = np.array([r["Safety Alert Triggered"] == "Yes" for r in test_rows], dtype=float)
    base_auc = float(roc_auc_score(actual, now))

    # Of the hours the model flags as high risk, how many really had an alert?
    flagged = prob >= 0.4
    precision = float(actual[flagged].mean()) if flagged.any() else 0.0
    recall = float(flagged[actual == 1].mean()) if (actual == 1).any() else 0.0

    metrics = {
        "model": "gradient boosting classifier, next-hour safety alert",
        "train_hours": len(train_rows), "test_hours": len(test_rows), "test_days": len(test_days),
        "split": "by day - the model is tested on days it never saw",
        "auc": round(auc, 3), "baseline_auc": round(base_auc, 3),
        "baseline": "an alert now predicts an alert next hour",
        "base_rate_pct": round(float(actual.mean()) * 100, 1),
        "precision_at_0.4_pct": round(precision * 100, 1), "recall_at_0.4_pct": round(recall * 100, 1),
    }
    final = _pipeline().fit(X(rows), y(rows))
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(final, MODEL_PATH)
    METRICS_PATH.write_text(json.dumps(metrics, indent=1))
    _CACHE.clear()
    return metrics


def _load():
    if "model" in _CACHE:
        return _CACHE["model"]
    if not MODEL_PATH.exists():
        return None
    try:
        import joblib

        _CACHE["model"] = joblib.load(MODEL_PATH)
    except Exception:  # noqa: BLE001
        _CACHE["model"] = None
    return _CACHE["model"]


def available() -> bool:
    return _load() is not None


def predict(features: dict) -> dict | None:
    """Probability of an alert in the next hour, and the reasons behind it."""
    model = _load()
    if model is None:
        return None
    prob = float(model.predict_proba(_frame([features]))[0, 1])

    # Explain by asking what the risk would be if each factor were calm.
    drops = []
    for key, calm in SAFE.items():
        if features.get(key) is None or float(features[key]) == float(calm):
            continue
        what_if = dict(features, **{key: calm})
        drop = prob - float(model.predict_proba(_frame([what_if]))[0, 1])
        if drop > 0.03:
            drops.append((drop, key))
    drops.sort(reverse=True)
    reasons = [{"key": k, "icon": REASONS[k][0], "hi": REASONS[k][1], "en": REASONS[k][2], "weight": round(d, 3)}
               for d, k in drops[:2] if k in REASONS]
    level = "high" if prob >= 0.5 else "medium" if prob >= 0.3 else "low"
    return {"probability": round(prob, 3), "level": level, "reasons": reasons}


def metrics() -> dict | None:
    return json.loads(METRICS_PATH.read_text()) if METRICS_PATH.exists() else None
