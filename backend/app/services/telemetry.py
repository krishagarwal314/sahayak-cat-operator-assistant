"""Live telemetry.

There is no real machine on the other end of this demo, so telemetry is
simulated - but simulated the way a real feed behaves: values drift smoothly,
they are derived from the shift clock rather than from random noise per request,
and each machine is seeded into a distinct, deliberately interesting state so
the difference between machines is visible the moment you switch.

Every sensor read carries its own status (ok / warn / crit) computed from the
thresholds declared in machines.json, which is what the whole safety and health
layer is built on.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import datetime, time as dtime

from .. import db

SHIFT_START = dtime(7, 0)
SHIFT_MINUTES = 9 * 60

# Each machine starts the shift in a state chosen to make the demo tell a story:
# the excavator is the one with problems, the loader is healthy but running a
# soft tyre, the dozer is near the end of its undercarriage life.
BASELINE: dict[str, dict[str, float]] = {
    "EXC001": {
        "fuel_level_pct": 46.0, "def_level_pct": 62.0, "engine_temp_c": 94.0,
        "hydraulic_temp_c": 89.5, "hydraulic_pressure_bar": 286.0, "engine_hours": 1523.5,
        "oil_pressure_kpa": 310.0, "battery_v": 13.6, "track_tension_pct": 64.0,
        "idling_time_min": 34.0, "load_cycles": 96.0, "swing_cycles": 188.0,
        "bucket_payload_kg": 1180.0, "ambient_temp_c": 33.0,
    },
    "LDR001": {
        "fuel_level_pct": 78.0, "def_level_pct": 55.0, "engine_temp_c": 88.0,
        "transmission_temp_c": 84.0, "engine_hours": 842.3, "oil_pressure_kpa": 325.0,
        "battery_v": 13.9, "tire_pressure_psi": 56.0, "payload_kg": 4850.0,
        "bucket_payload_kg": 4720.0, "idling_time_min": 12.0, "load_cycles": 64.0,
        "ambient_temp_c": 33.0,
    },
    "DZR001": {
        "fuel_level_pct": 61.0, "def_level_pct": 71.0, "engine_temp_c": 91.0,
        "transmission_temp_c": 88.0, "engine_hours": 2164.8, "oil_pressure_kpa": 298.0,
        "battery_v": 13.4, "track_tension_pct": 59.0, "undercarriage_wear_pct": 78.5,
        "blade_load_pct": 72.0, "idling_time_min": 21.0, "load_cycles": 28.0,
        "ambient_temp_c": 33.0,
    },
}

# Per-minute drift applied on top of the baseline.
DRIFT: dict[str, float] = {
    "fuel_level_pct": -0.055, "def_level_pct": -0.004, "engine_hours": 1 / 60,
    "idling_time_min": 0.030, "load_cycles": 0.42, "swing_cycles": 0.85,
    "undercarriage_wear_pct": 0.0004,
}

# Machine specific overrides. The excavator accumulates idle time roughly twice
# as fast as the others, which is the "excessive idling" story the anomaly
# engine is meant to catch.
DRIFT_OVERRIDE: dict[str, dict[str, float]] = {
    "EXC001": {"idling_time_min": 0.062, "load_cycles": 0.36},
    "LDR001": {"idling_time_min": 0.022, "load_cycles": 0.48},
    "DZR001": {"idling_time_min": 0.028, "load_cycles": 0.18},
}

# Sensors that oscillate rather than trend.
OSCILLATE: dict[str, tuple[float, float]] = {
    "engine_temp_c": (3.2, 47.0), "hydraulic_temp_c": (3.8, 53.0),
    "transmission_temp_c": (3.4, 61.0), "hydraulic_pressure_bar": (14.0, 29.0),
    "oil_pressure_kpa": (11.0, 37.0), "battery_v": (0.18, 23.0),
    "payload_kg": (520.0, 11.0), "blade_load_pct": (9.0, 17.0),
    "ambient_temp_c": (5.0, 240.0), "tire_pressure_psi": (0.9, 130.0),
    "track_tension_pct": (1.4, 190.0),
}

SEATBELT_OVERRIDE: dict[str, bool] = {}   # machine_id -> fastened, set by the UI


@dataclass
class Reading:
    key: str
    value: float | str
    unit: str
    label_en: str
    label_hi: str
    status: str            # ok | warn | crit | unknown
    warn_below: float | None = None
    crit_below: float | None = None
    warn_above: float | None = None
    crit_above: float | None = None

    def as_dict(self) -> dict:
        return {
            "key": self.key, "value": self.value, "unit": self.unit,
            "label_en": self.label_en, "label_hi": self.label_hi, "status": self.status,
            "warn_below": self.warn_below, "crit_below": self.crit_below,
            "warn_above": self.warn_above, "crit_above": self.crit_above,
        }


def shift_elapsed_minutes(now: datetime | None = None) -> float:
    """Minutes into the shift, clamped so an evening demo still looks sensible."""
    now = now or datetime.now()
    start = datetime.combine(now.date(), SHIFT_START)
    elapsed = (now - start).total_seconds() / 60.0
    if elapsed < 0:
        elapsed += 24 * 60
    return max(0.0, min(float(SHIFT_MINUTES), elapsed))


def _status(value: float, spec: dict) -> str:
    crit_below, warn_below = spec.get("crit_below"), spec.get("warn_below")
    crit_above, warn_above = spec.get("crit_above"), spec.get("warn_above")
    if crit_below is not None and value <= crit_below:
        return "crit"
    if crit_above is not None and value >= crit_above:
        return "crit"
    if warn_below is not None and value <= warn_below:
        return "warn"
    if warn_above is not None and value >= warn_above:
        return "warn"
    return "ok"


def _numeric_value(machine_id: str, key: str, elapsed: float) -> float | None:
    base = BASELINE.get(machine_id, {}).get(key)
    if base is None:
        return None
    drift = DRIFT_OVERRIDE.get(machine_id, {}).get(key, DRIFT.get(key, 0.0))
    value = base + drift * elapsed
    if key in OSCILLATE:
        amplitude, period = OSCILLATE[key]
        # Deterministic per machine+sensor phase, so the curve is stable across
        # requests but different for every gauge on screen.
        phase = (hash((machine_id, key)) % 1000) / 1000.0 * math.tau
        value += amplitude * math.sin(elapsed / period + phase)
    if key == "fuel_level_pct":
        value = max(3.0, value)
    if key.endswith("_pct"):
        value = max(0.0, min(100.0, value))
    return value


def seatbelt_state(machine_id: str, elapsed: float) -> bool:
    if machine_id in SEATBELT_OVERRIDE:
        return SEATBELT_OVERRIDE[machine_id]
    # The excavator operator unbuckles during the mid-shift break - this is the
    # violation the safety panel and the anomaly engine both pick up.
    if machine_id == "EXC001":
        return not (150 <= elapsed <= 200)
    return True


def proximity_objects(machine_id: str, elapsed: float) -> int:
    rng = random.Random(int(elapsed // 2) ^ hash(machine_id))
    roll = rng.random()
    if machine_id == "LDR001" and roll < 0.22:
        return 1
    return 1 if roll < 0.07 else 0


def snapshot(machine_id: str, now: datetime | None = None) -> dict:
    """Every sensor the machine exposes, with live values and status."""
    machine = db.machine(machine_id)
    if machine is None:
        raise KeyError(machine_id)

    now = now or datetime.now()
    elapsed = shift_elapsed_minutes(now)
    readings: dict[str, Reading] = {}

    for key, spec in machine["sensors"].items():
        label_en, label_hi = spec.get("label_en", key), spec.get("label_hi", key)
        unit = spec.get("unit", "")

        if key == "seatbelt":
            fastened = seatbelt_state(machine_id, elapsed)
            readings[key] = Reading(key, "Fastened" if fastened else "Unfastened", unit,
                                    label_en, label_hi, "ok" if fastened else "crit")
            continue
        if key == "proximity_objects":
            count = proximity_objects(machine_id, elapsed)
            readings[key] = Reading(key, count, unit, label_en, label_hi,
                                    "warn" if count else "ok")
            continue

        value = _numeric_value(machine_id, key, elapsed)
        if value is None:
            readings[key] = Reading(key, "n/a", unit, label_en, label_hi, "unknown")
            continue

        rounded = round(value, 1 if abs(value) < 1000 else 0)
        readings[key] = Reading(
            key, rounded, unit, label_en, label_hi, _status(value, spec),
            spec.get("warn_below"), spec.get("crit_below"),
            spec.get("warn_above"), spec.get("crit_above"),
        )

    worst = "ok"
    for reading in readings.values():
        if reading.status == "crit":
            worst = "crit"
            break
        if reading.status == "warn":
            worst = "warn"

    return {
        "machine_id": machine_id,
        "machine_name_en": machine["name_en"],
        "machine_name_hi": machine["name_hi"],
        "family": machine["family"],
        "timestamp": now.isoformat(timespec="seconds"),
        "shift_elapsed_min": round(elapsed, 1),
        "shift_remaining_min": round(SHIFT_MINUTES - elapsed, 1),
        "status": worst,
        "sensors": {k: r.as_dict() for k, r in readings.items()},
        "attention": [r.as_dict() for r in readings.values() if r.status in ("warn", "crit")],
    }


def value_of(machine_id: str, key: str, now: datetime | None = None) -> Reading | None:
    snap = snapshot(machine_id, now)
    raw = snap["sensors"].get(key)
    if raw is None:
        return None
    return Reading(**{k: v for k, v in raw.items()})


def fuel_estimate(machine_id: str, now: datetime | None = None) -> dict:
    """Litres left and how long they last at the current burn rate."""
    machine = db.machine(machine_id)
    snap = snapshot(machine_id, now)
    pct = snap["sensors"]["fuel_level_pct"]["value"]
    capacity = machine.get("fuel_capacity_l", 300)
    litres = capacity * float(pct) / 100.0
    burn_lph = {"excavator": 18.5, "loader": 15.0, "dozer": 21.0}.get(machine["family"], 17.0)
    hours_left = litres / burn_lph if burn_lph else 0.0
    return {
        "percent": round(float(pct), 1),
        "litres": round(litres, 1),
        "capacity_l": capacity,
        "burn_rate_lph": burn_lph,
        "hours_left": round(hours_left, 1),
        "minutes_left": round(hours_left * 60),
        "status": snap["sensors"]["fuel_level_pct"]["status"],
        "covers_shift": hours_left * 60 >= snap["shift_remaining_min"],
    }


def maintenance_status(machine_id: str, now: datetime | None = None) -> dict:
    machine = db.machine(machine_id)
    snap = snapshot(machine_id, now)
    hours = float(snap["sensors"]["engine_hours"]["value"])
    interval = machine.get("service_interval_hours", 500)
    last = machine.get("last_service_hours", 0)
    since = hours - last
    remaining = interval - since
    return {
        "engine_hours": round(hours, 1),
        "last_service_hours": last,
        "interval_hours": interval,
        "hours_since_service": round(since, 1),
        "hours_remaining": round(remaining, 1),
        "overdue": remaining <= 0,
        "due_soon": 0 < remaining <= 50,
    }


def set_seatbelt(machine_id: str, fastened: bool) -> None:
    SEATBELT_OVERRIDE[machine_id] = fastened


def recent_series(machine_id: str, key: str, points: int = 24, now: datetime | None = None) -> list[dict]:
    """A short trailing window of one sensor, for the dashboard sparklines."""
    now = now or datetime.now()
    elapsed = shift_elapsed_minutes(now)
    step = max(1.0, elapsed / points) if elapsed > points else 1.0
    series: list[dict] = []
    for i in range(points):
        t = max(0.0, elapsed - (points - 1 - i) * step)
        value = _numeric_value(machine_id, key, t)
        if value is None:
            continue
        series.append({"minute": round(t), "value": round(value, 1)})
    return series
