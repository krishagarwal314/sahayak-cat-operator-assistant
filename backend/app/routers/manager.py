"""Manager portal: assign work, watch the team, act on alerts.

The manager writes in English. Before a task is assigned they see the Hindi
the operator will hear, can correct it, and can listen to it - so no
operator is ever handed an instruction nobody has checked.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import db, security
from ..ai import translate
from ..services import anomaly, estimator, safety, tasks as task_service, telemetry

router = APIRouter(prefix="/api/manager", tags=["manager"])

# Job types a manager can assign, with sensible defaults for the form.
TASK_TYPES = [
    {"id": "trench_excavation", "families": ["excavator"], "icon": "dig", "default_minutes": 150, "default_cycles": 280,
     "label_en": "Trench excavation", "label_hi": "खाई की खुदाई"},
    {"id": "bulk_excavation", "families": ["excavator"], "icon": "dig", "default_minutes": 200, "default_cycles": 350,
     "label_en": "Bulk excavation", "label_hi": "बड़ी खुदाई"},
    {"id": "truck_loading", "families": ["excavator", "loader"], "icon": "truck", "default_minutes": 110, "default_cycles": 150,
     "label_en": "Truck loading", "label_hi": "ट्रक लोडिंग"},
    {"id": "stockpile_feeding", "families": ["loader"], "icon": "fill", "default_minutes": 180, "default_cycles": 160,
     "label_en": "Stockpile / crusher feeding", "label_hi": "क्रशर में फीडिंग"},
    {"id": "haul_road_maintenance", "families": ["dozer"], "icon": "blade", "default_minutes": 100, "default_cycles": 45,
     "label_en": "Haul road grading", "label_hi": "सड़क की ग्रेडिंग"},
    {"id": "site_cleanup", "families": ["excavator", "loader", "dozer"], "icon": "push", "default_minutes": 60, "default_cycles": 70,
     "label_en": "Site cleanup", "label_hi": "साइट की सफ़ाई"},
]
TASK_TYPES_BY_ID = {t["id"]: t for t in TASK_TYPES}


class HindiFields(BaseModel):
    title: str | None = None
    instructions: str | None = None
    safety_note: str | None = None
    location: str | None = None


class TaskDraft(BaseModel):
    operator_id: str
    machine_id: str
    task_type: str
    title_en: str = Field(..., min_length=3, max_length=160)
    instructions_en: str = Field("", max_length=1200)
    safety_note_en: str = Field("", max_length=600)
    location: str = Field("", max_length=160)
    priority: str = Field("medium", pattern="^(high|medium|low)$")
    planned_start: str = Field("08:00", pattern=r"^\d{2}:\d{2}$")
    planned_minutes: int = Field(90, ge=5, le=720)
    target_cycles: int | None = Field(None, ge=0, le=5000)
    hi: HindiFields | None = None


class TaskPatch(BaseModel):
    operator_id: str | None = None
    machine_id: str | None = None
    status: str | None = Field(None, pattern="^(pending|in_progress|done|blocked)$")
    priority: str | None = Field(None, pattern="^(high|medium|low)$")
    planned_start: str | None = Field(None, pattern=r"^\d{2}:\d{2}$")
    planned_minutes: int | None = Field(None, ge=5, le=720)


class TranslateDraft(BaseModel):
    title: str = ""
    instructions: str = ""
    safety_note: str = ""
    location: str = ""


def _certification(operator: dict, machine: dict) -> dict:
    family = machine["family"]
    certified = family in operator.get("certified_families", [])
    skill = operator.get("skill_scores", {}).get(family)
    return {"certified": certified, "skill": skill}


def _validate(draft_operator: str, draft_machine: str, task_type: str | None = None) -> tuple[dict, dict]:
    operator = db.operator(draft_operator)
    if operator is None or operator["role"] != "operator":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown operator")
    machine = db.machine(draft_machine)
    if machine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown machine")
    if task_type is not None:
        spec = TASK_TYPES_BY_ID.get(task_type)
        if spec is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown task type")
        if machine["family"] not in spec["families"]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"A {machine['family']} cannot do {spec['label_en'].lower()}")
    return operator, machine


# --------------------------------------------------------------------- reads
@router.get("/options")
def options(_: dict = Depends(security.current_manager)) -> dict:
    """Everything the assign form needs to populate itself."""
    return {
        "operators": [
            {k: o[k] for k in ("id", "name_en", "name_hi", "avatar_initials", "certified_families",
                               "skill_scores", "shift", "site", "experience_years")}
            for o in db.OPERATORS if o["role"] == "operator"
        ],
        "machines": [
            {k: m[k] for k in ("id", "model", "name_en", "name_hi", "family", "site")}
            for m in db.MACHINES
        ],
        "task_types": TASK_TYPES,
    }


@router.get("/overview")
def overview(_: dict = Depends(security.current_manager)) -> dict:
    """The whole site on one screen: people, their work, machines, incidents."""
    team = []
    for op in (o for o in db.OPERATORS if o["role"] == "operator"):
        rows = task_service.for_operator(op["id"], with_estimate=True)
        session = db.get_session(op["id"])
        done = sum(1 for t in rows if t["status"] == "done")
        team.append({
            "operator": {k: op[k] for k in ("id", "name_en", "name_hi", "avatar_initials",
                                            "certified_families", "skill_scores", "shift", "site")},
            "tasks": rows,
            "done": done,
            "total": len(rows),
            "planned_minutes": sum(t.get("planned_minutes", 0) for t in rows if t["status"] != "done"),
            "current_machine": session["machine_id"] if session else None,
            "active": any(t["status"] == "in_progress" for t in rows),
        })

    fleet = []
    for machine in db.MACHINES:
        health = anomaly.health_score(machine["id"])
        snap = telemetry.snapshot(machine["id"])
        report = safety.report(machine["id"])
        fleet.append({
            "id": machine["id"], "model": machine["model"], "name_en": machine["name_en"],
            "name_hi": machine["name_hi"], "family": machine["family"], "site": machine["site"],
            "status": snap["status"], "health": health["score"], "counts": health["counts"],
            "top_finding": health["findings"][0] if health["findings"] else None,
            "fuel_pct": snap["sensors"].get("fuel_level_pct", {}).get("value"),
            "seatbelt": snap["sensors"].get("seatbelt", {}).get("value"),
            "safety_score": report["score"],
            "operators": [t["operator"]["id"] for t in team if t["current_machine"] == machine["id"]],
        })

    all_tasks = [t for member in team for t in member["tasks"]]
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "team": team,
        "fleet": fleet,
        "incidents": db.incidents_for()[:20],
        "bookings": sorted(db.BOOKINGS, key=lambda b: b["created_at"], reverse=True)[:20],
        "kpis": {
            "operators": len(team),
            "operators_active": sum(1 for t in team if t["active"]),
            "tasks_total": len(all_tasks),
            "tasks_done": sum(1 for t in all_tasks if t["status"] == "done"),
            "tasks_in_progress": sum(1 for t in all_tasks if t["status"] == "in_progress"),
            "machines_attention": sum(1 for m in fleet if m["status"] != "ok"),
            "machines_critical": sum(1 for m in fleet if m["counts"]["critical"]),
            "incidents": len(db.INCIDENTS),
        },
    }


# --------------------------------------------------------------------- drafts
@router.post("/estimate")
def estimate_draft(draft: TaskDraft, _: dict = Depends(security.current_manager)) -> dict:
    """Predicted duration for a task before it is assigned."""
    operator, machine = _validate(draft.operator_id, draft.machine_id, draft.task_type)
    probe = {"id": "draft", "task_type": draft.task_type, "machine_id": machine["id"],
             "operator_id": operator["id"], "planned_minutes": draft.planned_minutes, "status": "pending"}
    est = estimator.estimate(probe)
    return {**est, "certification": _certification(operator, machine)}


@router.post("/translate")
def translate_draft(draft: TranslateDraft, _: dict = Depends(security.current_manager)) -> dict:
    """What the operator will read and hear, for the manager to check first."""
    out: dict[str, str | None] = {}
    engine = None
    for field in ("title", "instructions", "safety_note", "location"):
        english = getattr(draft, field).strip()
        if not english:
            out[field] = ""
            continue
        result = translate.translate(english, source="en", target="hi")
        out[field] = result.text if result else None
        engine = engine or (result.engine if result else None)
    available = any(v for v in out.values())
    return {
        "hi": out,
        "engine": engine,
        "available": available,
        "note": None if available else
        "Translation model is not loaded. Type the Hindi yourself, or leave it blank and the operator sees English.",
    }


# --------------------------------------------------------------------- writes
@router.post("/tasks")
def create_task(draft: TaskDraft, manager: dict = Depends(security.current_manager)) -> dict:
    operator, machine = _validate(draft.operator_id, draft.machine_id, draft.task_type)
    spec = TASK_TYPES_BY_ID[draft.task_type]
    approved = {k: v.strip() for k, v in (draft.hi.model_dump() if draft.hi else {}).items() if v and v.strip()}
    record = {
        "operator_id": operator["id"],
        "machine_id": machine["id"],
        "task_type": draft.task_type,
        "title_en": draft.title_en.strip(),
        "instructions_en": draft.instructions_en.strip(),
        "safety_note_en": draft.safety_note_en.strip(),
        "location": draft.location.strip() or machine["site"],
        "priority": draft.priority,
        "planned_start": draft.planned_start,
        "planned_minutes": draft.planned_minutes,
        "target_cycles": draft.target_cycles if draft.target_cycles is not None else spec["default_cycles"],
        "assigned_by": manager["id"],
        "hi_approved": approved,
        "sequence": 0,
    }
    created = db.add_task(record)
    return {
        "task": task_service.enrich(created),
        "certification": _certification(operator, machine),
        "message": f"Assigned to {operator['name_en']}. It will appear on their phone.",
    }


@router.patch("/tasks/{task_id}")
def update_task(task_id: str, patch: TaskPatch, _: dict = Depends(security.current_manager)) -> dict:
    row = db.task(task_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    fields = {k: v for k, v in patch.model_dump().items() if v is not None}
    if "operator_id" in fields or "machine_id" in fields:
        _validate(fields.get("operator_id", row["operator_id"]), fields.get("machine_id", row["machine_id"]),
                  row["task_type"])
    previous_operator = row["operator_id"]
    updated = db.update_task(task_id, **fields)
    db.resequence(updated["operator_id"])
    if previous_operator != updated["operator_id"]:
        db.resequence(previous_operator)
    db.save_tasks()
    return {"task": task_service.enrich(updated)}


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str, _: dict = Depends(security.current_manager)) -> dict:
    removed = db.remove_task(task_id)
    if removed is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return {"removed": task_id}
