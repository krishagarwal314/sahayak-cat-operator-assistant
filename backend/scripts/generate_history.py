"""Generate the historical datasets the prototype learns from.

Produces two files under app/seed/:
  * task_history.json     - completed tasks, used by the task-time estimator
  * telemetry_history.csv - hourly machine telemetry in the schema given in the
                            problem statement, extended with the extra sensors
                            each machine family exposes.

Deterministic (fixed seed) so the repo always carries the same data.
"""

from __future__ import annotations

import csv
import json
import math
import random
from datetime import datetime, timedelta
from pathlib import Path

SEED_DIR = Path(__file__).resolve().parents[1] / "app" / "seed"
RNG = random.Random(20250501)

MACHINES = {
    "EXC001": {"family": "excavator", "operators": ["OP1001", "OP1003"], "start_hours": 1180.0},
    "LDR001": {"family": "loader", "operators": ["OP1002", "OP1004"], "start_hours": 690.0},
    "DZR001": {"family": "dozer", "operators": ["OP1002", "OP1005"], "start_hours": 2020.0},
}

# base minutes per 100 "units" of work for each task type, per machine family
TASK_TYPES = {
    "trench_excavation": {"family": "excavator", "base": 150, "unit": "metres", "nominal_units": 40},
    "truck_loading": {"family": "any", "base": 110, "unit": "trucks", "nominal_units": 12},
    "site_cleanup": {"family": "any", "base": 60, "unit": "passes", "nominal_units": 8},
    "stockpile_feeding": {"family": "loader", "base": 180, "unit": "buckets", "nominal_units": 160},
    "haul_road_maintenance": {"family": "dozer", "base": 100, "unit": "metres", "nominal_units": 600},
    "bulk_excavation": {"family": "excavator", "base": 200, "unit": "cubic metres", "nominal_units": 350},
}

WEATHER = ["clear", "hot", "rain", "overcast", "dust"]
# multiplicative effect of each condition on task duration
WEATHER_FACTOR = {"clear": 1.00, "hot": 1.08, "rain": 1.26, "overcast": 1.02, "dust": 1.12}
GROUND = ["dry", "wet", "rocky", "soft"]
GROUND_FACTOR = {"dry": 1.00, "wet": 1.15, "rocky": 1.22, "soft": 0.95}
SHIFTS = ["day", "night"]
SHIFT_FACTOR = {"day": 1.00, "night": 1.09}


def gen_task_history(n: int = 420) -> list[dict]:
    rows: list[dict] = []
    start = datetime(2025, 2, 1, 7, 0)
    for i in range(n):
        ttype, spec = RNG.choice(list(TASK_TYPES.items()))
        family = spec["family"]
        candidates = [m for m, meta in MACHINES.items() if family in ("any", meta["family"])]
        machine = RNG.choice(candidates)
        operator = RNG.choice(MACHINES[machine]["operators"])

        units = max(1, round(spec["nominal_units"] * RNG.uniform(0.55, 1.65)))
        weather = RNG.choice(WEATHER)
        ground = RNG.choice(GROUND)
        shift = RNG.choices(SHIFTS, weights=[0.75, 0.25])[0]
        ambient = round(RNG.uniform(18, 44), 1)
        operator_skill = round(RNG.uniform(0.45, 0.95), 2)

        # ground truth duration model the estimator has to rediscover from data
        minutes = spec["base"] * (units / spec["nominal_units"])
        minutes *= WEATHER_FACTOR[weather]
        minutes *= GROUND_FACTOR[ground]
        minutes *= SHIFT_FACTOR[shift]
        minutes *= 1.0 + (0.75 - operator_skill) * 0.45          # slower when less skilled
        minutes *= 1.0 + max(0.0, ambient - 35) * 0.010          # heat derate
        minutes *= RNG.uniform(0.93, 1.09)                       # irreducible noise

        completed = start + timedelta(hours=RNG.randint(0, 24 * 120))
        rows.append(
            {
                "record_id": f"H{i:04d}",
                "task_type": ttype,
                "machine_id": machine,
                "machine_family": MACHINES[machine]["family"],
                "operator_id": operator,
                "units": units,
                "unit_label": spec["unit"],
                "weather": weather,
                "ground": ground,
                "shift": shift,
                "ambient_temp_c": ambient,
                "operator_skill": operator_skill,
                "actual_minutes": round(minutes, 1),
                "completed_at": completed.isoformat(timespec="seconds"),
            }
        )
    rows.sort(key=lambda r: r["completed_at"])
    return rows


def gen_telemetry(days: int = 30) -> list[dict]:
    """Hourly telemetry per machine, with a few deliberately anomalous stretches."""
    rows: list[dict] = []
    for machine, meta in MACHINES.items():
        hours = meta["start_hours"]
        family = meta["family"]
        operator = meta["operators"][0]
        day0 = datetime(2025, 5, 1, 7, 0)
        for d in range(days):
            # every ~9th day this machine has a "bad" day: heavy idling, belt off
            bad_day = (d + hash(machine) % 9) % 9 == 0
            fuel_pct = RNG.uniform(70, 100)
            for h in range(9):  # 9 hour shift
                ts = day0 + timedelta(days=d, hours=h)
                working = RNG.random() > (0.42 if bad_day else 0.15)
                idle_min = RNG.uniform(30, 55) if (bad_day and not working) else (
                    RNG.uniform(2, 12) if working else RNG.uniform(14, 30)
                )
                cycles = 0 if not working else RNG.randint(6, 18)
                fuel_used = round(RNG.uniform(4.0, 7.5) if working else RNG.uniform(1.2, 3.0), 1)
                fuel_pct = max(6.0, fuel_pct - fuel_used / 4.1)
                hours += 1.0
                ambient = 24 + 12 * math.sin((h - 2) / 9 * math.pi) + RNG.uniform(-2, 2)
                engine_temp = 82 + (ambient - 28) * 0.45 + (6 if cycles > 14 else 0) + RNG.uniform(-3, 4)
                seatbelt = "Unfastened" if (bad_day and RNG.random() < 0.35) else "Fastened"
                proximity = RNG.random() < (0.10 if bad_day else 0.03)
                alert = seatbelt == "Unfastened" or idle_min > 45 or engine_temp > 103 or proximity

                row = {
                    "Timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
                    "Machine ID": machine,
                    "Operator ID": operator,
                    "Engine Hours": round(hours, 1),
                    "Fuel Used (L)": fuel_used,
                    "Fuel Level (%)": round(fuel_pct, 1),
                    "Load Cycles": cycles,
                    "Idling Time (min)": round(idle_min),
                    "Seatbelt Status": seatbelt,
                    "Safety Alert Triggered": "Yes" if alert else "No",
                    "Engine Temp (C)": round(engine_temp, 1),
                    "Ambient Temp (C)": round(ambient, 1),
                    "Proximity Event": "Yes" if proximity else "No",
                }
                if family == "excavator":
                    row["Hydraulic Temp (C)"] = round(engine_temp - 8 + RNG.uniform(-3, 7), 1)
                    row["Hydraulic Pressure (bar)"] = round(RNG.uniform(245, 320), 1)
                    row["Track Tension (%)"] = round(RNG.uniform(58, 88), 1)
                elif family == "loader":
                    row["Transmission Temp (C)"] = round(engine_temp - 6 + RNG.uniform(-4, 9), 1)
                    row["Payload (kg)"] = round(RNG.uniform(3800, 5900)) if cycles else 0
                    row["Tyre Pressure (psi)"] = round(RNG.uniform(60, 72), 1)
                else:
                    row["Transmission Temp (C)"] = round(engine_temp - 5 + RNG.uniform(-4, 10), 1)
                    row["Track Tension (%)"] = round(RNG.uniform(55, 85), 1)
                    row["Undercarriage Wear (%)"] = round(48 + d * 0.15 + RNG.uniform(-1, 1), 1)
                rows.append(row)
    rows.sort(key=lambda r: (r["Timestamp"], r["Machine ID"]))
    return rows


def main() -> None:
    SEED_DIR.mkdir(parents=True, exist_ok=True)

    tasks = gen_task_history()
    (SEED_DIR / "task_history.json").write_text(
        json.dumps(tasks, indent=1, ensure_ascii=False), encoding="utf-8"
    )

    telemetry = gen_telemetry()
    fields: list[str] = []
    for row in telemetry:
        for key in row:
            if key not in fields:
                fields.append(key)
    with (SEED_DIR / "telemetry_history.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, restval="")
        writer.writeheader()
        writer.writerows(telemetry)

    print(f"task_history.json      {len(tasks)} rows")
    print(f"telemetry_history.csv  {len(telemetry)} rows, {len(fields)} columns")


if __name__ == "__main__":
    main()
