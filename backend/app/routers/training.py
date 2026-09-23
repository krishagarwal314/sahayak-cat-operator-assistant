from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, security
from ..schemas import BookingRequest

router = APIRouter(prefix="/api/training", tags=["training"])


@router.get("")
def hub(
    machine_id: str | None = None, operator: dict = Depends(security.current_operator)
) -> dict:
    """Training modules, filtered to the selected machine and ranked by need."""
    machine = db.machine(machine_id) if machine_id else None
    family = machine["family"] if machine else None
    skills = operator.get("skill_scores", {})

    modules = [
        m for m in db.TRAINING["modules"]
        if family is None or m["family"] in (family, "all")
    ]
    # The weakest machine family first: training the operator actually needs.
    for module in modules:
        score = skills.get(module["family"], skills.get(family or "", 0.7))
        module["recommended"] = score < 0.7 or module["skill_tag"] == "safety"

    modules.sort(key=lambda m: (not m["recommended"], m["duration_min"]))
    return {
        "machine_id": machine_id,
        "family": family,
        "modules": modules,
        "instructors": db.TRAINING["instructors"],
        "bookings": [b for b in db.BOOKINGS if b["operator_id"] == operator["id"]],
        "skill_scores": skills,
    }


@router.post("/book")
def book(payload: BookingRequest, operator: dict = Depends(security.current_operator)) -> dict:
    instructor = next(
        (i for i in db.TRAINING["instructors"] if i["id"] == payload.instructor_id), None
    )
    if instructor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown instructor")
    if payload.slot not in instructor["slots"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That slot is not available")

    record = db.add_booking(
        {
            "operator_id": operator["id"],
            "instructor_id": instructor["id"],
            "instructor_name_en": instructor["name_en"],
            "instructor_name_hi": instructor["name_hi"],
            "slot": payload.slot,
            "module_id": payload.module_id,
        }
    )
    return {
        "booking": record,
        "confirmation": {
            "hi": f"{instructor['name_hi']} के साथ {payload.slot} का सत्र बुक हो गया है।",
            "en": f"Session booked with {instructor['name_en']} at {payload.slot}.",
        },
    }
