"""Face login endpoints.

    GET    /api/face/status          who is enrolled, is the camera path live
    POST   /api/face/login           image in, session token out
    POST   /api/face/enroll          add a face sample for an operator
    DELETE /api/face/enroll/{id}     forget an operator's face
    POST   /api/auth/tap             tap-your-photo login, the camera fallback

No passwords anywhere in this flow.
"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from .. import db, security
from ..ai import face
from ..config import settings

router = APIRouter(tags=["face"])

MAX_IMAGE_BYTES = 6 * 1024 * 1024


def _people() -> list[dict]:
    counts = face.enrolled()
    return [
        {
            "id": o["id"],
            "name_en": o["name_en"],
            "name_hi": o["name_hi"],
            "role": o["role"],
            "avatar_initials": o["avatar_initials"],
            "face_samples": counts.get(o["id"], 0),
        }
        for o in db.OPERATORS
    ]


def _session(operator: dict, method: str, score: float | None = None) -> dict:
    token, expires_in = security.issue_token(operator)
    greeting_hi = f"नमस्ते {operator['name_hi']}!"
    greeting_en = f"Hello {operator['name_en']}!"
    return {
        "token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "operator": security.public_operator(operator),
        "method": method,
        "score": round(score, 3) if score is not None else None,
        "greeting": {"hi": greeting_hi, "en": greeting_en},
    }


async def _read_image(image: UploadFile) -> bytes:
    raw = await image.read()
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty image")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image too large")
    return raw


@router.get("/api/face/status")
def face_status() -> dict:
    return {
        "available": face.available(),
        "allow_enroll": settings.allow_face_enroll,
        "allow_tap": settings.allow_tap_login,
        "people": _people(),
        "samples_needed": 3,
        "max_samples": face.MAX_SAMPLES,
    }


@router.post("/api/face/login")
async def face_login(image: UploadFile = File(...)) -> dict:
    raw = await _read_image(image)
    try:
        result = face.identify(raw)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not read the image")

    if result.status != "match":
        return {"matched": False, **result.as_dict()}

    operator = db.operator(result.operator_id or "")
    if operator is None:
        # A face on file for someone no longer on the roster.
        return {"matched": False, **result.as_dict()}
    return {"matched": True, **result.as_dict(), **_session(operator, "face", result.score)}


@router.post("/api/face/enroll")
async def face_enroll(operator_id: str = Form(...), image: UploadFile = File(...)) -> dict:
    if not settings.allow_face_enroll:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Face enrolment is done by a supervisor")
    if db.operator(operator_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown operator")
    raw = await _read_image(image)
    try:
        result = face.enroll(operator_id, raw)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not read the image")
    return {"saved": result.status == "enrolled", "samples": face.enrolled().get(operator_id, 0),
            **result.as_dict()}


@router.delete("/api/face/enroll/{operator_id}")
def face_forget(operator_id: str) -> dict:
    if not settings.allow_face_enroll:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Face enrolment is done by a supervisor")
    face.forget(operator_id)
    return {"forgotten": operator_id}


class TapRequest(BaseModel):
    operator_id: str


@router.post("/api/auth/tap")
def tap_login(payload: TapRequest) -> dict:
    """Tap your own photo. The fallback when there is no camera or no match."""
    if not settings.allow_tap_login:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tap login is disabled on this site")
    operator = db.operator(payload.operator_id)
    if operator is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown operator")
    return _session(operator, "tap")
