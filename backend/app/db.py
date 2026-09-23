"""In-memory store.

A prototype does not need a database, but it does need one obvious place where
state lives. Seed files are read once at import; everything the operator changes
during a shift (task status, incidents, bookings, chat history) lives in the
mutable sections below and resets when the process restarts.
"""

from __future__ import annotations

import csv
import json
import threading
from datetime import datetime
from typing import Any

from .config import settings

_LOCK = threading.RLock()


def _read_json(name: str) -> Any:
    return json.loads((settings.seed_dir / name).read_text(encoding="utf-8"))


def _read_csv(name: str) -> list[dict[str, str]]:
    with (settings.seed_dir / name).open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


# ---------------------------------------------------------------- static seed
OPERATORS: list[dict] = _read_json("operators.json")
MACHINES: list[dict] = _read_json("machines.json")
TASKS_SEED: list[dict] = _read_json("tasks.json")
TRAINING: dict = _read_json("training.json")
GUIDES: list[dict] = _read_json("guides.json")
GUIDES_BY_ID = {g["id"]: g for g in GUIDES}
TASK_HISTORY: list[dict] = _read_json("task_history.json")
TELEMETRY_HISTORY: list[dict] = _read_csv("telemetry_history.csv")

OPERATORS_BY_ID = {o["id"]: o for o in OPERATORS}
MACHINES_BY_ID = {m["id"]: m for m in MACHINES}

# --------------------------------------------------------------- mutable state
TASKS: list[dict] = [dict(t) for t in TASKS_SEED]
INCIDENTS: list[dict] = []
BOOKINGS: list[dict] = []
CONVERSATIONS: dict[str, list[dict]] = {}
SESSIONS: dict[str, dict] = {}          # operator_id -> {machine_id, started_at}
ROUTER_LOG: list[dict] = []             # every routed utterance, for the analytics view


# ----------------------------------------------------------------- accessors
def operator(operator_id: str) -> dict | None:
    return OPERATORS_BY_ID.get(operator_id)


def machine(machine_id: str) -> dict | None:
    return MACHINES_BY_ID.get(machine_id)


def guides_for(family: str | None) -> list[dict]:
    """Guides that apply to a machine family, general ones first."""
    rows = [g for g in GUIDES if family is None or family in g["families"]]
    return sorted(rows, key=lambda g: (len(g["families"]) < 3, GUIDES.index(g)))


def guide_for_task(family: str, task_type: str | None) -> dict:
    """The single most useful guide for what the operator is doing right now."""
    specific = {
        ("excavator", "trench_excavation"): "excavator_trench",
        ("excavator", "bulk_excavation"): "excavator_trench",
        ("loader", "truck_loading"): "loader_truck",
        ("loader", "stockpile_feeding"): "loader_truck",
        ("dozer", "haul_road_maintenance"): "dozer_push",
    }
    by_family = {"excavator": "excavator_trench", "loader": "loader_truck", "dozer": "dozer_push"}
    guide_id = specific.get((family, task_type or "")) or by_family.get(family, "pre_start")
    return GUIDES_BY_ID[guide_id]


def machines_for_operator(operator_id: str) -> list[dict]:
    """Machines this operator is certified on, assigned machines first."""
    op = operator(operator_id)
    if not op:
        return []
    assigned = {t["machine_id"] for t in tasks_for_operator(operator_id)}
    certified = set(op.get("certified_families", []))

    def sort_key(m: dict) -> tuple:
        return (0 if m["id"] in assigned else 1,
                0 if m["family"] in certified else 1,
                m["id"])

    return sorted(MACHINES, key=sort_key)


def tasks_for_operator(operator_id: str, machine_id: str | None = None) -> list[dict]:
    rows = [t for t in TASKS if t["operator_id"] == operator_id]
    if machine_id:
        rows = [t for t in rows if t["machine_id"] == machine_id]
    return sorted(rows, key=lambda t: t["sequence"])


def task(task_id: str) -> dict | None:
    return next((t for t in TASKS if t["id"] == task_id), None)


def update_task(task_id: str, **fields) -> dict | None:
    with _LOCK:
        row = task(task_id)
        if row is None:
            return None
        row.update(fields)
        row["updated_at"] = datetime.now().isoformat(timespec="seconds")
        return row


def active_task(operator_id: str, machine_id: str | None = None) -> dict | None:
    """The task in progress, else the next pending one."""
    rows = tasks_for_operator(operator_id, machine_id)
    return (next((t for t in rows if t["status"] == "in_progress"), None)
            or next((t for t in rows if t["status"] == "pending"), None))


def next_task(operator_id: str, machine_id: str | None = None) -> dict | None:
    current = active_task(operator_id, machine_id)
    rows = tasks_for_operator(operator_id)
    if current is None:
        return rows[0] if rows else None
    later = [t for t in rows if t["sequence"] > current["sequence"] and t["status"] != "done"]
    return later[0] if later else None


def add_incident(record: dict) -> dict:
    with _LOCK:
        record.setdefault("id", f"INC-{len(INCIDENTS) + 1:04d}")
        record.setdefault("created_at", datetime.now().isoformat(timespec="seconds"))
        INCIDENTS.append(record)
        return record


def incidents_for(operator_id: str | None = None, machine_id: str | None = None) -> list[dict]:
    rows = INCIDENTS
    if operator_id:
        rows = [r for r in rows if r.get("operator_id") == operator_id]
    if machine_id:
        rows = [r for r in rows if r.get("machine_id") == machine_id]
    return sorted(rows, key=lambda r: r["created_at"], reverse=True)


def add_booking(record: dict) -> dict:
    with _LOCK:
        record.setdefault("id", f"BK-{len(BOOKINGS) + 1:04d}")
        record.setdefault("created_at", datetime.now().isoformat(timespec="seconds"))
        BOOKINGS.append(record)
        return record


def set_session(operator_id: str, machine_id: str) -> dict:
    with _LOCK:
        SESSIONS[operator_id] = {
            "machine_id": machine_id,
            "started_at": datetime.now().isoformat(timespec="seconds"),
        }
        return SESSIONS[operator_id]


def get_session(operator_id: str) -> dict | None:
    return SESSIONS.get(operator_id)


def log_turn(operator_id: str, record: dict) -> None:
    with _LOCK:
        CONVERSATIONS.setdefault(operator_id, []).append(record)
        ROUTER_LOG.append({"operator_id": operator_id, **record})
        if len(ROUTER_LOG) > 500:
            del ROUTER_LOG[:-500]


def conversation(operator_id: str, limit: int = 30) -> list[dict]:
    return CONVERSATIONS.get(operator_id, [])[-limit:]


def telemetry_history(machine_id: str, limit: int = 200) -> list[dict]:
    rows = [r for r in TELEMETRY_HISTORY if r["Machine ID"] == machine_id]
    return rows[-limit:]


def task_history(task_type: str | None = None, machine_id: str | None = None) -> list[dict]:
    rows = TASK_HISTORY
    if task_type:
        rows = [r for r in rows if r["task_type"] == task_type]
    if machine_id:
        rows = [r for r in rows if r["machine_id"] == machine_id]
    return rows


def reset_runtime_state() -> None:
    """Used by the demo reset button so a second run starts clean."""
    global TASKS
    with _LOCK:
        TASKS = [dict(t) for t in TASKS_SEED]
        INCIDENTS.clear()
        BOOKINGS.clear()
        CONVERSATIONS.clear()
        SESSIONS.clear()
        ROUTER_LOG.clear()
