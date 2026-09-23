"""Task time estimation.

"Predict time to complete a task based on past data and environmental
conditions" - so the estimate comes from the machine's own completed-task
history, not from a guess baked into the task definition.

The model is a similarity-weighted k-nearest-neighbour regression on
minutes-per-unit. Chosen deliberately over a fitted regressor: with a few
hundred records it is just as accurate, it needs no training step, and - the
part that actually matters in a cab - it can point at the specific past jobs the
estimate came from, and name the conditions that pushed it up or down.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .. import db
from . import site

K = 25                       # neighbours considered
MIN_SAMPLES = 6              # below this we fall back to the planned duration

# How strongly a mismatch on each categorical feature is penalised.
FEATURE_WEIGHT = {"weather": 1.0, "ground": 0.9, "shift": 0.55, "machine": 0.7}

# Nominal work content per task type, used to convert a task into "units".
NOMINAL_UNITS = {
    "trench_excavation": 40, "truck_loading": 12, "site_cleanup": 8,
    "stockpile_feeding": 160, "haul_road_maintenance": 600, "bulk_excavation": 350,
}


@dataclass
class Factor:
    label_en: str
    label_hi: str
    effect_pct: float


def _units_for(task: dict) -> float:
    """Express the task as the same 'units' the history is recorded in."""
    nominal = NOMINAL_UNITS.get(task["task_type"], 10)
    planned = task.get("planned_minutes") or 60
    # Scale nominal work content by how long the planner allowed relative to the
    # median historical job of this type.
    rows = db.task_history(task["task_type"])
    if rows:
        median_minutes = sorted(r["actual_minutes"] for r in rows)[len(rows) // 2]
        if median_minutes > 0:
            return nominal * (planned / median_minutes)
    return float(nominal)


def _similarity(row: dict, ctx: dict, units: float) -> float:
    distance = 0.0
    for feature, key in (("weather", "weather"), ("ground", "ground"), ("shift", "shift")):
        if row[key] != ctx[key]:
            distance += FEATURE_WEIGHT[feature]
    if row["machine_id"] != ctx["machine_id"]:
        distance += FEATURE_WEIGHT["machine"] * (0.4 if row["machine_family"] == ctx["machine_family"] else 1.0)

    distance += abs(row["ambient_temp_c"] - ctx["ambient_temp_c"]) / 25.0
    distance += abs(row["operator_skill"] - ctx["operator_skill"]) * 1.4
    # Jobs of a very different size are weaker evidence for minutes-per-unit.
    if units > 0 and row["units"] > 0:
        distance += abs(math.log(row["units"] / units)) * 0.6
    return math.exp(-distance)


def _factors(ctx: dict, rows: list[dict]) -> list[Factor]:
    """Name the conditions that move this estimate, measured from the data."""
    factors: list[Factor] = []
    if not rows:
        return factors

    def mean_rate(subset: list[dict]) -> float | None:
        rates = [r["actual_minutes"] / r["units"] for r in subset if r["units"]]
        return sum(rates) / len(rates) if rates else None

    overall = mean_rate(rows)
    if not overall:
        return factors

    comparisons = [
        ("weather", ctx["weather"], site.WEATHER_EN.get(ctx["weather"], ctx["weather"]),
         site.WEATHER_HI.get(ctx["weather"], ctx["weather"])),
        ("ground", ctx["ground"], site.GROUND_EN.get(ctx["ground"], ctx["ground"]),
         site.GROUND_HI.get(ctx["ground"], ctx["ground"])),
        ("shift", ctx["shift"], f"{ctx['shift'].title()} shift",
         "दिन की शिफ्ट" if ctx["shift"] == "day" else "रात की शिफ्ट"),
    ]
    for key, value, label_en, label_hi in comparisons:
        subset = [r for r in rows if r[key] == value]
        rate = mean_rate(subset)
        if rate is None or len(subset) < 4:
            continue
        effect = (rate / overall - 1.0) * 100
        if abs(effect) >= 4:
            factors.append(Factor(label_en, label_hi, round(effect, 1)))

    skill = ctx["operator_skill"]
    if skill >= 0.8:
        factors.append(Factor("Your experience on this machine", "इस मशीन पर आपका अनुभव", -6.0))
    elif skill <= 0.5:
        factors.append(Factor("Limited hours on this machine", "इस मशीन पर कम अनुभव", 8.0))

    factors.sort(key=lambda f: abs(f.effect_pct), reverse=True)
    return factors[:3]


def estimate(task: dict, *, machine_id: str | None = None, operator_id: str | None = None,
             progress: float = 0.0) -> dict:
    """Predicted minutes for a task, with a range and an explanation."""
    machine_id = machine_id or task["machine_id"]
    operator_id = operator_id or task["operator_id"]
    machine = db.machine(machine_id) or {}
    operator = db.operator(operator_id) or {}

    conditions = site.conditions(machine_id)
    ctx = {
        "weather": conditions["weather"],
        "ground": conditions["ground"],
        "shift": conditions["shift"],
        "ambient_temp_c": conditions["ambient_temp_c"],
        "machine_id": machine_id,
        "machine_family": machine.get("family", ""),
        "operator_skill": float(operator.get("skill_scores", {}).get(machine.get("family", ""), 0.65)),
    }

    units = _units_for(task)
    rows = db.task_history(task["task_type"])
    planned = float(task.get("planned_minutes") or 60)

    if len(rows) < MIN_SAMPLES:
        return {
            "expected_minutes": round(planned),
            "low_minutes": round(planned * 0.85),
            "high_minutes": round(planned * 1.2),
            "confidence": 0.35,
            "samples": len(rows),
            "basis": "planned",
            "factors": [],
            "conditions": conditions,
            "remaining_minutes": round(planned * (1 - progress)),
        }

    scored = sorted(
        ((_similarity(row, ctx, units), row) for row in rows),
        key=lambda pair: pair[0],
        reverse=True,
    )[:K]

    weights = [w for w, _ in scored]
    rates = [row["actual_minutes"] / row["units"] for _, row in scored if row["units"]]
    total_weight = sum(weights) or 1.0
    weighted_rate = sum(w * r for w, r in zip(weights, rates)) / total_weight

    expected = weighted_rate * units

    # Spread of the neighbours becomes the prediction interval.
    ordered = sorted(rates)
    low_rate = ordered[max(0, int(len(ordered) * 0.2) - 1)]
    high_rate = ordered[min(len(ordered) - 1, int(len(ordered) * 0.8))]

    # Confidence falls when neighbours disagree or when few of them are close.
    spread = (high_rate - low_rate) / weighted_rate if weighted_rate else 1.0
    close = sum(1 for w in weights if w > 0.35)
    confidence = max(0.35, min(0.95, 0.9 - spread * 0.5 + close / (K * 8)))

    return {
        "expected_minutes": round(expected),
        "low_minutes": round(low_rate * units),
        "high_minutes": round(high_rate * units),
        "confidence": round(confidence, 2),
        "samples": len(scored),
        "basis": "history",
        "planned_minutes": round(planned),
        "delta_vs_planned": round(expected - planned),
        "factors": [{"label_en": f.label_en, "label_hi": f.label_hi, "effect_pct": f.effect_pct}
                    for f in _factors(ctx, [row for _, row in scored])],
        "conditions": conditions,
        "remaining_minutes": round(expected * (1 - progress)),
        "units": round(units, 1),
    }


def progress_of(task: dict, machine_id: str) -> float:
    """Fraction complete, from cycles accumulated since the task was started.

    A pending task is 0% by definition; a finished one is 100%. Only a task the
    operator actually started is measured against the machine counter, using the
    counter reading captured at start time.
    """
    from . import telemetry

    status = task.get("status")
    if status == "done":
        return 1.0
    if status != "in_progress":
        return 0.0

    target = float(task.get("target_cycles") or 0)
    if target <= 0:
        return 0.0
    try:
        reading = telemetry.snapshot(machine_id)["sensors"].get("load_cycles")
    except KeyError:
        return 0.0
    if not reading or not isinstance(reading["value"], (int, float)):
        return 0.0

    start_cycles = float(task.get("started_cycles") or 0.0)
    done = float(reading["value"]) - start_cycles
    return max(0.0, min(1.0, done / target))
