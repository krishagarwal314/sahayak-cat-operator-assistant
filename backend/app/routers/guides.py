"""Step by step machine instructions.

Every step is one short action with a picture and a slow spoken line, so an
operator can follow it without reading.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, security
from ..services.speech_text import to_speech

router = APIRouter(prefix="/api/guides", tags=["guides"])


def _summary(guide: dict) -> dict:
    return {
        "id": guide["id"],
        "icon": guide["icon"],
        "color": guide["color"],
        "title_hi": guide["title_hi"],
        "title_en": guide["title_en"],
        "steps": len(guide["steps"]),
        "families": guide["families"],
    }


@router.get("")
def list_guides(machine_id: str | None = None, _: dict = Depends(security.current_operator)) -> list[dict]:
    machine = db.machine(machine_id) if machine_id else None
    return [_summary(g) for g in db.guides_for(machine["family"] if machine else None)]


@router.get("/{guide_id}")
def get_guide(guide_id: str, _: dict = Depends(security.current_operator)) -> dict:
    guide = db.GUIDES_BY_ID.get(guide_id)
    if guide is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown guide")
    steps = []
    for index, step in enumerate(guide["steps"], start=1):
        steps.append({
            **step,
            "number": index,
            "warning": bool(step.get("warning")),
            # What the voice will actually say, numbered so the operator always
            # knows where they are: "कदम दो। ..."
            "speech_hi": to_speech(f"कदम {index}। {step['say_hi']}", slow=True),
            "speech_en": f"Step {index}. {step['say_en']}",
        })
    return {**_summary(guide), "intro_hi": guide["intro_hi"], "intro_en": guide["intro_en"],
            "intro_speech_hi": to_speech(guide["intro_hi"], slow=True), "steps": steps}
