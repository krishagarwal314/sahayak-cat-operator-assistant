"""Task presentation: the manager writes English, the operator hears Hindi.

Translation order of preference:
  1. the translation model (IndicTrans2 / NLLB), when it is downloaded
  2. the curated Hindi in seed/tasks_hi.json
  3. the original English

Keeping the curated layer means a laptop with no models still gives a complete
Hindi demo, and it doubles as a reference to compare the model output against.
"""

from __future__ import annotations

import json
import logging

from .. import db
from ..ai import translate
from ..config import settings
from . import estimator, telemetry

log = logging.getLogger("sahayak.tasks")

_FALLBACK_HI: dict[str, dict] = json.loads(
    (settings.seed_dir / "tasks_hi.json").read_text(encoding="utf-8")
)

_FIELDS = ("title", "instructions", "safety_note")

# Site names are transliterated rather than translated, so they come only from
# the curated file - a translation model mangles "Pit B - North Bench".
_CURATED_ONLY = ("location",)


def _translate_field(task_id: str, field: str, english: str) -> tuple[str, str]:
    """Returns (hindi_text, source) where source is model | curated | english."""
    curated = _FALLBACK_HI.get(task_id, {}).get(field)
    result = translate.translate(english, source="en", target="hi")
    if result and result.text:
        return result.text, "model"
    if curated:
        return curated, "curated"
    return english, "english"


def localize(task: dict) -> dict:
    """One task with a Hindi block attached."""
    hindi: dict[str, str] = {}
    source = "english"
    for field in _FIELDS:
        english = task.get(f"{field}_en", "")
        if not english:
            continue
        hindi[field], source = _translate_field(task["id"], field, english)
    for field in _CURATED_ONLY:
        curated = _FALLBACK_HI.get(task["id"], {}).get(field)
        hindi[field] = curated or task.get(field, "")
    return {**task, "hi": hindi, "translation_source": source}


def enrich(task: dict, *, with_estimate: bool = True) -> dict:
    """Task + Hindi + live progress + predicted time, ready for the UI."""
    out = localize(task)
    machine = db.machine(task["machine_id"])
    out["machine"] = {
        "id": task["machine_id"],
        "name_en": machine["name_en"] if machine else task["machine_id"],
        "name_hi": machine["name_hi"] if machine else task["machine_id"],
        "model": machine["model"] if machine else "",
        "family": machine["family"] if machine else "",
        "icon": machine.get("icon") if machine else "",
    }
    progress = estimator.progress_of(task, task["machine_id"])
    out["progress"] = round(progress, 3)
    if with_estimate:
        out["estimate"] = estimator.estimate(task, progress=progress)
    return out


def for_operator(operator_id: str, *, machine_id: str | None = None,
                 with_estimate: bool = True) -> list[dict]:
    return [enrich(t, with_estimate=with_estimate)
            for t in db.tasks_for_operator(operator_id, machine_id)]


def hindi_map(operator_id: str) -> dict[str, dict]:
    """task_id -> Hindi fields, passed into the response generator."""
    return {t["id"]: localize(t)["hi"] for t in db.tasks_for_operator(operator_id)}


def briefing(operator_id: str) -> dict:
    """The shift briefing that gets read aloud on the tasks screen."""
    operator = db.operator(operator_id)
    if operator is None:
        raise KeyError(operator_id)

    tasks = for_operator(operator_id)
    machines = sorted({t["machine_id"] for t in tasks})
    machine_names_hi = "، ".join(
        (db.machine(m) or {}).get("name_hi", m) for m in machines
    )
    machine_names_en = ", ".join((db.machine(m) or {}).get("name_en", m) for m in machines)

    total_planned = sum(t.get("planned_minutes", 0) for t in tasks)
    total_estimated = sum(t.get("estimate", {}).get("expected_minutes", 0) for t in tasks)

    lines_hi = [
        f"नमस्ते {operator['name_hi']}, आपकी {operator.get('shift_hi', operator['shift'])} है।",
        f"आज आपके लिए {len(tasks)} काम निर्धारित हैं और आप {machine_names_hi} पर काम करेंगे।",
    ]
    lines_en = [
        f"Hello {operator['name_en']}, your shift is {operator['shift']}.",
        f"You have {len(tasks)} tasks today and you will be working on the {machine_names_en}.",
    ]
    for index, task in enumerate(tasks, start=1):
        title_hi = task["hi"].get("title", task["title_en"])
        minutes = task.get("estimate", {}).get("expected_minutes", task.get("planned_minutes", 0))
        location_hi = task["hi"].get("location") or task["location"]
        lines_hi.append(f"काम {index}: {title_hi}। जगह {location_hi}। अनुमानित समय {minutes} मिनट।")
        lines_en.append(f"Task {index}: {task['title_en']}. Location {task['location']}. "
                        f"Estimated {minutes} minutes.")

    safety_notes_hi = [t["hi"].get("safety_note") for t in tasks if t["hi"].get("safety_note")]
    if safety_notes_hi:
        lines_hi.append("सुरक्षा के लिए ध्यान दें। " + safety_notes_hi[0])
        lines_en.append("Safety note. " + (tasks[0].get("safety_note_en") or ""))

    lines_hi.append("काम शुरू करने के लिए अपनी मशीन चुनें।")
    lines_en.append("Select your machine to begin.")

    return {
        "operator": {
            "id": operator["id"],
            "name_en": operator["name_en"],
            "name_hi": operator["name_hi"],
            "shift": operator["shift"],
            "shift_hi": operator.get("shift_hi", operator["shift"]),
            "site": operator["site"],
            "avatar_initials": operator["avatar_initials"],
        },
        "task_count": len(tasks),
        "machines": machines,
        "planned_minutes": total_planned,
        "estimated_minutes": total_estimated,
        "tasks": tasks,
        "text": {"hi": " ".join(lines_hi), "en": " ".join(lines_en)},
        "lines": {"hi": lines_hi, "en": lines_en},
    }


def recommended_machines(operator_id: str) -> list[dict]:
    """Machines to show on the selection screen, assigned ones first."""
    operator = db.operator(operator_id) or {}
    assigned = {t["machine_id"] for t in db.tasks_for_operator(operator_id)}
    certified = set(operator.get("certified_families", []))

    out: list[dict] = []
    for machine in db.machines_for_operator(operator_id):
        machine_tasks = db.tasks_for_operator(operator_id, machine["id"])
        try:
            snap = telemetry.snapshot(machine["id"])
            status = snap["status"]
            attention = len(snap["attention"])
        except KeyError:
            status, attention = "unknown", 0

        out.append(
            {
                "id": machine["id"],
                "model": machine["model"],
                "name_en": machine["name_en"],
                "name_hi": machine["name_hi"],
                "short_hi": machine["short_hi"],
                "family": machine["family"],
                "icon": machine["icon"],
                "site": machine["site"],
                "assigned": machine["id"] in assigned,
                "certified": machine["family"] in certified,
                "task_count": len(machine_tasks),
                "next_task": machine_tasks[0]["title_en"] if machine_tasks else None,
                "status": status,
                "attention_count": attention,
                "quick_questions_hi": machine["quick_questions_hi"],
                "quick_questions_en": machine["quick_questions_en"],
            }
        )
    return out
