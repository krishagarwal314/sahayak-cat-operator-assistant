from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, security
from ..schemas import TaskStatusRequest
from ..services import telemetry, tasks as task_service

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("/briefing")
def briefing(operator: dict = Depends(security.current_operator)) -> dict:
    """Today's work, in English and Hindi, ready to be read aloud."""
    return task_service.briefing(operator["id"])


@router.get("")
def list_tasks(
    machine_id: str | None = None,
    operator: dict = Depends(security.current_operator),
) -> list[dict]:
    return task_service.for_operator(operator["id"], machine_id=machine_id)


@router.post("/{task_id}/status")
def set_status(
    task_id: str,
    payload: TaskStatusRequest,
    operator: dict = Depends(security.current_operator),
) -> dict:
    task = db.task(task_id)
    if task is None or task["operator_id"] != operator["id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")

    fields: dict = {"status": payload.status}
    if payload.status == "in_progress":
        # Capture the machine's cycle counter so progress is measured from here.
        try:
            reading = telemetry.snapshot(task["machine_id"])["sensors"].get("load_cycles")
            fields["started_cycles"] = reading["value"] if reading else 0
        except KeyError:
            fields["started_cycles"] = 0
    updated = db.update_task(task_id, **fields)
    return task_service.enrich(updated)
