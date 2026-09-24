from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, security
from ..schemas import IncidentRequest, SeatbeltRequest
from ..services import safety as safety_service, telemetry

router = APIRouter(prefix="/api/safety", tags=["safety"])


@router.get("/{machine_id}")
def report(machine_id: str, operator: dict = Depends(security.current_operator)) -> dict:
    if db.machine(machine_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown machine")
    return safety_service.report(machine_id, operator["id"])


@router.post("/incident")
def log_incident(
    payload: IncidentRequest, operator: dict = Depends(security.current_operator)
) -> dict:
    if db.machine(payload.machine_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown machine")
    record = safety_service.log_incident(
        operator_id=operator["id"],
        machine_id=payload.machine_id,
        description=payload.description,
        category=payload.category,
        severity=payload.severity,
        language=payload.language,
    )
    return {
        "incident": record,
        "confirmation": {
            "hi": f"घटना दर्ज कर दी गई है, रिपोर्ट नंबर {record['id']}। सुपरवाइज़र को सूचित कर दिया गया है।",
            "en": f"Incident logged as {record['id']}. Your supervisor has been notified.",
        },
    }


@router.get("/incidents/all")
def incidents(
    machine_id: str | None = None, operator: dict = Depends(security.current_operator)
) -> list[dict]:
    return db.incidents_for(operator["id"], machine_id)


@router.post("/seatbelt")
def set_seatbelt(payload: SeatbeltRequest, _: dict = Depends(security.current_operator)) -> dict:
    """Demo control: flip the belt sensor to show the alert path live."""
    if db.machine(payload.machine_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown machine")
    telemetry.set_seatbelt(payload.machine_id, payload.fastened)
    return telemetry.snapshot(payload.machine_id)["sensors"]["seatbelt"]


@router.post("/fatigue")
def fatigue(payload: dict, operator: dict = Depends(security.current_operator)) -> dict:
    """A fatigue sign the cab camera saw: eyes closed too long, or a yawn."""
    kind = payload.get("kind")
    if kind not in ("drowsy", "yawn"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "kind must be drowsy or yawn")
    record = db.add_fatigue_event({
        "operator_id": operator["id"], "machine_id": payload.get("machine_id"), "kind": kind,
        "seconds": payload.get("seconds"), "perclos": payload.get("perclos"),
    })
    return {"event": record, "count": len(db.fatigue_events_for(operator["id"], payload.get("machine_id")))}
