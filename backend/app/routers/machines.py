from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, security
from ..schemas import SelectMachineRequest
from ..services import anomaly, assistant, safety, site, telemetry, tasks as task_service

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
