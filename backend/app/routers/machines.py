from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, security
from ..schemas import SelectMachineRequest
from ..services import anomaly, assistant, coach as coach_service, safety, signals as signal_service, site, telemetry, tasks as task_service
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
    # "नियम एक। ..." rather than "1. ...": a bare "1." is read with a stray pause.
    safety_hi = " ".join(f"नियम {i}। {s['hi']}" for i, s in enumerate(info["safety"], 1))
    safety_en = " ".join(f"Rule {i}. {s['en']}" for i, s in enumerate(info["safety"], 1))
    guides = [db.GUIDES_BY_ID[g] for g in info["guides"] if g in db.GUIDES_BY_ID]

    # Safety is read first. Everything else can wait; this cannot.
    sections = [
        {"id": "safety", "hi": f"सबसे पहले, इस मशीन पर सुरक्षा के नियम। {safety_hi}",
         "en": f"First, the safety rules for this machine. {safety_en}"},
        {"id": "summary", "hi": f"{info['identify_hi']} {info['summary_hi']}", "en": f"{info['identify_en']} {info['summary_en']}"},
        {"id": "parts", "hi": f"इसके मुख्य हिस्से। {parts_hi}", "en": f"Its main parts. {parts_en}"},
        {"id": "video", "hi": "मशीन कैसे चलाते हैं, यह देखने के लिए लाल बटन दबाइए।",
         "en": "To see how to operate the machine, tap the red play button."},
        {"id": "guides", "hi": "कदम कदम सीखने के लिए नीचे की तस्वीरें दबाइए।",
         "en": "To learn step by step, tap the pictures below."},
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
        "video": db.MACHINE_ABOUT.get(machine_id, {}).get("video"),
        # Predicted risk, working conditions and fatigue, for every machine.
        "safety_extra": safety.extra_warnings(machine_id, operator["id"]),
        "safety_rules": db.MACHINE_ABOUT.get(machine_id, {}).get("safety", []),
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


@router.get("/{machine_id}/signals")
def signals(machine_id: str, speak: bool = False, language: str = "hi",
            operator: dict = Depends(security.current_operator)) -> dict:
    """What the small ML models say about this operator on this machine, one card each."""
    if db.machine(machine_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown machine")
    body = signal_service.signals(machine_id, operator["id"])
    if speak:
        # The mic on the dashboard reads the headline and the top warnings.
        import base64

        from ..ai import tts

        lang = "en" if language == "en" else "hi"
        top = [x["say"][lang] for x in body["signals"]
               if x["level"] != "ok" and x["say"][lang] != body["headline"][lang]][:2]
        body["summary"] = {lang: " ".join([body["headline"][lang], *top])}
        speech = tts.synthesize(body["summary"][lang], language=lang)
        body["audio"] = ({"base64": base64.b64encode(speech.wav).decode("ascii"), "mime": speech.mime,
                          "sample_rate": speech.sample_rate, "duration_s": speech.duration_s,
                          "engine": speech.engine} if speech else None)
    return body


@router.get("/{machine_id}/coach")
def coach(machine_id: str, operator: dict = Depends(security.current_operator)) -> dict:
    """The safety-risk model asked "what if?" - a break, the seatbelt, an eased load."""
    if db.machine(machine_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown machine")
    body = coach_service.coach(machine_id, operator["id"])
    if body is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Safety-risk model not trained")
    return body


@router.get("/{machine_id}/anomalies")
def anomalies(machine_id: str, _: dict = Depends(security.current_operator)) -> dict:
    return anomaly.health_score(machine_id)


@router.get("/{machine_id}/history")
def history(machine_id: str, limit: int = 120, _: dict = Depends(security.current_operator)) -> dict:
    """Raw telemetry rows, in the schema from the problem statement."""
    return {"machine_id": machine_id, "rows": db.telemetry_history(machine_id, limit=limit)}
