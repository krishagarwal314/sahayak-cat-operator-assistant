"""Unusual-use model: which hours in a machine's log look like misuse?

Works on the problem statement's hourly telemetry (Fuel Used, Load Cycles,
Idling Time, Engine Hours, temperatures). No labels are needed to train it: an
Isolation Forest learns what normal hours look like for each machine family and
scores how easily an hour can be separated from them. Hours that are strange
as a *combination* - idle but burning working-level fuel, no work and no
idling yet the engine is running - are exactly what single-column thresholds
miss and what this catches.

The synthetic history has misuse planted in it with labels (the "Unusual Use"
column). The model never sees those labels; they are only used to score it,
with every day held out once (5 folds by day), against a baseline of simple
per-column thresholds flagging the same number of hours.

Every flagged hour is explained in one sentence, in Hindi and English.
"""

from __future__ import annotations

import csv
import json

from ..config import BACKEND_DIR, settings

MODEL_PATH = BACKEND_DIR / "models" / "ml" / "unusual_use.joblib"
METRICS_PATH = BACKEND_DIR / "models" / "ml" / "unusual_use_metrics.json"

FAMILY = {"EXC001": "excavator", "LDR001": "loader", "DZR001": "dozer"}
FEATURES = ["fuel_l", "cycles", "idle_min", "stopped_idle_min", "engine_over_ambient", "fuel_excess"]
# Share of hours flagged. Kept small: a supervisor reads every flag.
FLAG_RATE = 0.05

_CACHE: dict = {}


def features_from_row(r: dict) -> dict:
    fuel = float(r["Fuel Used (L)"])
    cycles = float(r["Load Cycles"])
    idle = float(r["Idling Time (min)"])
    return {
        "fuel_l": fuel,
        "cycles": cycles,
        "idle_min": idle,
        # In an hour with no work, the engine should mostly have been idling (or
        # off). Very little idling with no work means it ran for something else.
        # Working hours get a neutral value so they don't look odd here.
        "stopped_idle_min": idle if cycles == 0 else 25.0,
        "engine_over_ambient": float(r["Engine Temp (C)"]) - float(r["Ambient Temp (C)"]),
    }


def _load_rows() -> list[dict]:
    with (settings.seed_dir / "telemetry_history.csv").open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _raw(rows: list[dict]):
    import numpy as np

    return np.array([[features_from_row(r)[f] for f in FEATURES[:-1]] for r in rows])


def _fuel_fit(X):
    """Diesel an hour *should* burn, given its work and idling - fitted on the log."""
    from sklearn.linear_model import HuberRegressor

    # Huber, so the misuse hours hiding in the log barely pull the fit.
    return HuberRegressor(max_iter=500).fit(_fuel_inputs(X), X[:, 0])


def _fuel_inputs(X):
    """Working or not, load cycles, idling minutes: a working hour costs a step more diesel."""
    import numpy as np

    return np.column_stack([X[:, 1] > 0, X[:, 1], X[:, 2]])


def _matrix(rows: list[dict], fuel_fit):
    import numpy as np

    X = _raw(rows)
    excess = X[:, 0] - fuel_fit.predict(_fuel_inputs(X))
    return np.column_stack([X, excess])


def _forest():
    from sklearn.ensemble import IsolationForest

    return IsolationForest(n_estimators=300, max_samples=256, random_state=7)


def _fit(rows: list[dict]) -> dict:
    """One forest per machine family, plus each family's normal ranges."""
    import numpy as np

    models = {}
    for family in sorted(set(FAMILY.values())):
        fam = [r for r in rows if FAMILY.get(r["Machine ID"]) == family]
        fuel_fit = _fuel_fit(_raw(fam))
        X = _matrix(fam, fuel_fit)
        forest = _forest().fit(X)
        scores = -forest.score_samples(X)
        models[family] = {
            "forest": forest, "fuel_fit": fuel_fit,
            "threshold": float(np.quantile(scores, 1 - FLAG_RATE)),
            "median": np.median(X, axis=0),
            "p10": np.quantile(X, 0.10, axis=0),
            "p90": np.quantile(X, 0.90, axis=0),
        }
    return models


def _score(models: dict, rows: list[dict]):
    import numpy as np

    out = np.zeros(len(rows))
    for family, m in models.items():
        idx = [i for i, r in enumerate(rows) if FAMILY.get(r["Machine ID"]) == family]
        if idx:
            out[idx] = -m["forest"].score_samples(_matrix([rows[i] for i in idx], m["fuel_fit"]))
    return out


def _baseline_score(train: list[dict], test: list[dict]):
    """Per-column thresholds: how far outside its normal range is the worst column."""
    import numpy as np

    Xtr, Xte = _raw(train), _raw(test)
    med = np.median(Xtr, axis=0)
    iqr = np.quantile(Xtr, 0.75, axis=0) - np.quantile(Xtr, 0.25, axis=0) + 1e-6
    # Only the raw columns from the table, as a threshold rule would use.
    raw = [FEATURES.index(f) for f in ("fuel_l", "cycles", "idle_min", "engine_over_ambient")]
    return np.abs((Xte - med) / iqr)[:, raw].max(axis=1)


def train() -> dict:
    import joblib
    import numpy as np
    from sklearn.metrics import roc_auc_score

    rows = _load_rows()
    days = sorted({r["Timestamp"][:10] for r in rows})
    folds = [set(days[i::5]) for i in range(5)]

    model_scores = np.zeros(len(rows))
    base_scores = np.zeros(len(rows))
    for held in folds:
        train_rows = [r for r in rows if r["Timestamp"][:10] not in held]
        test_idx = [i for i, r in enumerate(rows) if r["Timestamp"][:10] in held]
        test_rows = [rows[i] for i in test_idx]
        model_scores[test_idx] = _score(_fit(train_rows), test_rows)
        base_scores[test_idx] = _baseline_score(train_rows, test_rows)

    actual = np.array([bool(r.get("Unusual Use")) for r in rows], dtype=int)

    def at_flag_rate(scores):
        flagged = scores >= np.quantile(scores, 1 - FLAG_RATE)
        precision = float(actual[flagged].mean())
        recall = float(flagged[actual == 1].mean())
        return round(precision * 100, 1), round(recall * 100, 1)

    precision, recall = at_flag_rate(model_scores)
    base_precision, base_recall = at_flag_rate(base_scores)

    by_kind = {}
    flagged = model_scores >= np.quantile(model_scores, 1 - FLAG_RATE)
    for kind in sorted({r["Unusual Use"] for r in rows if r.get("Unusual Use")}):
        mask = np.array([r.get("Unusual Use") == kind for r in rows])
        by_kind[kind] = round(float(flagged[mask].mean()) * 100, 1)

    metrics = {
        "model": "isolation forest per machine family, unsupervised",
        "hours": len(rows), "misuse_hours": int(actual.sum()),
        "split": "5 folds by day - every hour is scored by a model that never saw its day",
        "flag_rate_pct": FLAG_RATE * 100,
        "auc": round(float(roc_auc_score(actual, model_scores)), 3),
        "baseline_auc": round(float(roc_auc_score(actual, base_scores)), 3),
        "baseline": "per-column thresholds on fuel, cycles, idling and engine temperature",
        "precision_pct": precision, "recall_pct": recall,
        "baseline_precision_pct": base_precision, "baseline_recall_pct": base_recall,
        "recall_by_kind_pct": by_kind,
    }
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(_fit(rows), MODEL_PATH)
    METRICS_PATH.write_text(json.dumps(metrics, indent=1))
    _CACHE.clear()
    return metrics


def _load():
    if "model" not in _CACHE:
        _CACHE["model"] = None
        if MODEL_PATH.exists():
            try:
                import joblib

                _CACHE["model"] = joblib.load(MODEL_PATH)
            except Exception:  # noqa: BLE001
                pass
    return _CACHE["model"]


def available() -> bool:
    return _load() is not None


def _explain(f: dict, m: dict) -> tuple[str, str, str]:
    """The one sentence a supervisor needs, picked from the hour's shape."""
    med = dict(zip(FEATURES, m["median"]))
    p90 = dict(zip(FEATURES, m["p90"]))
    if f["cycles"] == 0 and f["idle_min"] >= p90["idle_min"] * 0.8 and f["fuel_l"] > p90["fuel_l"] * 0.6:
        return ("idle_burn",
                "मशीन खाली खड़ी थी, फिर भी काम जितना डीज़ल जला। इंजन तेज़ चलाकर खड़ा रखा गया।",
                "Standing idle but burning working-level fuel: the engine was revved while parked.")
    if f["cycles"] == 0 and f["idle_min"] < 10:
        return ("no_work_run",
                "इंजन चलता रहा, पर न काम हुआ न आइडलिंग। बिना दर्ज काम के मशीन चलाई गई।",
                "The engine ran with no work and no idling logged: unrecorded use of the machine.")
    if f["cycles"] > p90["cycles"] * 1.2:
        return ("overworking",
                "मशीन बहुत तेज़ी से और बहुत ज़्यादा चलाई गई, इंजन भी गरम हुआ। इससे मशीन घिसती है।",
                "Far more cycles than normal with a hot engine: the machine was driven too hard.")
    if f["fuel_excess"] > 2.0:
        return ("fuel_loss",
                "काम के हिसाब से बहुत ज़्यादा डीज़ल लगा। रिसाव या चोरी की जाँच करें।",
                "Much more diesel than the work explains: check for a leak or theft.")
    worst = max(FEATURES, key=lambda k: abs(f[k] - med[k]) / (abs(p90[k] - med[k]) + 1e-6))
    return ("other",
            "यह घंटा इस मशीन के आम घंटों से अलग था। जाँच करें।",
            f"This hour did not look like this machine's normal hours (mostly {worst.replace('_', ' ')}).")


def scan(machine_id: str, rows: list[dict]) -> list[dict]:
    """Flag the unusual hours in a machine's log, most unusual first."""
    models = _load()
    family = FAMILY.get(machine_id)
    if not models or family not in models or not rows:
        return []
    m = models[family]
    scores = _score({family: m}, rows)
    out = []
    for row, score in zip(rows, scores):
        if score < m["threshold"]:
            continue
        f = dict(zip(FEATURES, _matrix([row], m["fuel_fit"])[0]))
        kind, hi, en = _explain(f, m)
        out.append({
            "timestamp": row["Timestamp"], "kind": kind, "score": round(float(score), 3),
            "text": {"hi": hi, "en": en},
            "evidence": {"fuel_l": round(f["fuel_l"], 1), "extra_fuel_l": round(f["fuel_excess"], 1), "load_cycles": int(f["cycles"]),
                         "idle_min": round(f["idle_min"]),
                         "normal_fuel_l": round(float(m["median"][0]), 1),
                         "normal_cycles": round(float(m["median"][1]))},
        })
    out.sort(key=lambda x: x["score"], reverse=True)
    return out


def metrics() -> dict | None:
    return json.loads(METRICS_PATH.read_text()) if METRICS_PATH.exists() else None
