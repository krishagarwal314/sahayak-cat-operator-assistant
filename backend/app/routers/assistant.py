from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, security
from ..ai import tts
from ..schemas import AskRequest
from ..services import assistant as assistant_service

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


def _attach_speech(result: dict, language: str) -> dict:
    """Render the reply to audio and inline it as base64."""
    spoken = result["reply"]["speech"].get(language) or result["reply"]["text"].get(language, "")
    speech = tts.synthesize(spoken, language=language)
    if speech is None:
        result["audio"] = None
        # The browser falls back to the Web Speech API using this text.
        result["speech_fallback_text"] = spoken
        return result
    result["audio"] = {
        "base64": base64.b64encode(speech.wav).decode("ascii"),
        "mime": "audio/wav",
        "sample_rate": speech.sample_rate,
        "duration_s": speech.duration_s,
        "latency_ms": speech.latency_ms,
        "engine": speech.engine,
    }
    return result


@router.post("/ask")
def ask(payload: AskRequest, operator: dict = Depends(security.current_operator)) -> dict:
    if not payload.text and not payload.intent:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Provide either text or intent")
    try:
        result = assistant_service.ask(
            operator_id=operator["id"],
            machine_id=payload.machine_id,
            text=payload.text,
            intent=payload.intent,
            language=payload.language,
            source="quick_action" if payload.intent and not payload.text else "text",
        )
    except KeyError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown machine")

    if payload.speak:
        result = _attach_speech(result, payload.language)
    return result


@router.get("/suggestions")
def suggestions(machine_id: str, operator: dict = Depends(security.current_operator)) -> list[dict]:
    return assistant_service.suggestions(machine_id, operator["id"])


@router.get("/history")
def history(limit: int = 30, operator: dict = Depends(security.current_operator)) -> list[dict]:
    return assistant_service.history(operator["id"], limit)


@router.get("/analytics")
def analytics(_: dict = Depends(security.current_operator)) -> dict:
    """Which router stage answered each question - the architecture, measured."""
    return assistant_service.analytics()


@router.get("/intents")
def intents(machine_id: str | None = None, _: dict = Depends(security.current_operator)) -> dict:
    from ..ai.intent.taxonomy import INTENTS

    supported = assistant_service.supported_intents(machine_id) if machine_id else None
    return {
        "count": len(INTENTS),
        "intents": [
            {
                "name": name,
                "domain": spec.domain,
                "description": spec.description,
                "sensors": list(spec.sensors),
                "examples": list(spec.examples[:4]),
                "supported": (supported is None or name in supported),
            }
            for name, spec in sorted(INTENTS.items())
        ],
    }
