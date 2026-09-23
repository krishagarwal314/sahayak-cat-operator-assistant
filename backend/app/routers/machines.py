from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, security
from ..schemas import SelectMachineRequest
from ..services import anomaly, assistant, safety, site, telemetry, tasks as task_service
from ..services.speech_text import to_speech

router = APIRouter(prefix="/api/machines", tags=["machines"])


@router.get("")
def list_machines(operator: dict = Depends(security.current_operator)) -> list[dict]:
    """Machines for the selection screen, assigned ones first."""
    return task_service.recommended_machines(operator["id"])


@router.post("/select")
def select(
    payload: SelectMachineRequest,
    operator: dict = Depends(security.current_operator),
) -> dict:
    machine = db.machine(payload.machine_id)
    if machine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown machine")
    session = db.set_session(operator["id"], machine["id"])
    return {
        "session": session,
        "machine": machine,
        "suggestions": assistant.suggestions(machine["id"], operator["id"]),
    }


@router.get("/{machine_id}/about")
def about(machine_id: str, _: dict = Depends(security.current_operator)) -> dict:
    """Everything an operator should hear about a machine before using it.

    Returned as ordered sections, each with its own spoken text, so the page
    can read itself top to bottom and highlight the part being read.
    """
    machine = db.machine(machine_id)
    info = db.MACHINE_ABOUT.get(machine_id)
    if machine is None or info is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown machine")

    parts_hi = " ".join(f"{p['name_hi']}, {p['what_hi']}" for p in info["parts"])
    parts_en = " ".join(f"{p['name_en']}: {p['what_en']}" for p in info["parts"])
    safety_hi = " ".join(f"{i}. {s['hi']}" for i, s in enumerate(info["safety"], 1))
    safety_en = " ".join(f"{i}. {s['en']}" for i, s in enumerate(info["safety"], 1))
    guides = [db.GUIDES_BY_ID[g] for g in info["guides"] if g in db.GUIDES_BY_ID]

    sections = [
        {"id": "summary", "hi": f"{info['identify_hi']} {info['summary_hi']}", "en": f"{info['identify_en']} {info['summary_en']}"},
        {"id": "parts", "hi": f"इसके मुख्य हिस्से। {parts_hi}", "en": f"Its main parts. {parts_en}"},
        {"id": "safety", "hi": f"इस मशीन पर सुरक्षा के नियम। {safety_hi}", "en": f"Safety rules for this machine. {safety_en}"},
        {"id": "guides", "hi": "इसे चलाना सीखने के लिए नीचे की तस्वीरें दबाइए। वीडियो भी देख सकते हैं।",
         "en": "To learn to operate it, tap the pictures below. You can also watch the video."},
    ]
    for section in sections:
        section["speech_hi"] = to_speech(section["hi"], slow=True)

    return {
        "machine": {k: machine[k] for k in ("id", "model", "name_en", "name_hi", "short_hi", "family", "site")},
        **info,
        "guides": [{"id": g["id"], "icon": g["icon"], "color": g["color"], "title_hi": g["title_hi"],
                    "title_en": g["title_en"], "steps": len(g["steps"])} for g in guides],
        "sections": sections,
    }


@router.get("/{machine_id}")
def detail(machine_id: str, operator: dict = Depends(security.current_operator)) -> dict:
    """Everything the cockpit screen renders in one call."""
    machine = db.machine(machine_id)
    if machine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown machine")

    current = db.active_task(operator["id"], machine_id)
    return {
        "machine": machine,
        "telemetry": telemetry.snapshot(machine_id),
        "health": anomaly.health_score(machine_id),
        "safety": safety.report(machine_id, operator["id"]),
        "fuel": telemetry.fuel_estimate(machine_id),
        "maintenance": telemetry.maintenance_status(machine_id),
        "conditions": site.conditions(machine_id),
        "current_task": task_service.enrich(current) if current else None,
        "suggestions": assistant.suggestions(machine_id, operator["id"]),
        "supported_intents": sorted(assistant.supported_intents(machine_id)),
    }


@router.get("/{machine_id}/telemetry")
def live_telemetry(machine_id: str, _: dict = Depends(security.current_operator)) -> dict:
    try:
        return telemetry.snapshot(machine_id)
    except KeyError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown machine")


@router.get("/{machine_id}/series/{sensor}")
def series(
    machine_id: str,
    sensor: str,
    points: int = 24,
    _: dict = Depends(security.current_operator),
) -> dict:
    return {
        "machine_id": machine_id,
        "sensor": sensor,
        "points": telemetry.recent_series(machine_id, sensor, points=points),
    }


@router.get("/{machine_id}/anomalies")
def anomalies(machine_id: str, _: dict = Depends(security.current_operator)) -> dict:
    return anomaly.health_score(machine_id)


@router.get("/{machine_id}/history")
def history(machine_id: str, limit: int = 120, _: dict = Depends(security.current_operator)) -> dict:
    """Raw telemetry rows, in the schema from the problem statement."""
    return {"machine_id": machine_id, "rows": db.telemetry_history(machine_id, limit=limit)}
