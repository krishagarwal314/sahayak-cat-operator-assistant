"""The voice pipeline: speech in, speech out.

    audio -> STT -> intent router -> machine data -> Hindi template -> TTS -> audio

Every stage reports its own latency, which the UI shows as a timing strip. It is
the clearest way to make the point that classification is milliseconds and the
models around it are the expensive part.
"""

from __future__ import annotations

import base64
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response

from .. import security
from ..ai import stt, translate, tts
from ..schemas import SpeakRequest, TranslateRequest
from ..services import assistant as assistant_service

router = APIRouter(prefix="/api/voice", tags=["voice"])

MAX_AUDIO_BYTES = 20 * 1024 * 1024


@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: str = Form("hi"),
    _: dict = Depends(security.current_operator),
) -> dict:
    raw = await audio.read()
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Audio too large")

    result = stt.transcribe(raw, language=language)
    if result is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Speech recognition is not available. Run scripts/download_models.py, or type the question instead.",
        )
    return {
        "text": result.text,
        "language": result.language,
        "duration_s": result.duration_s,
        "latency_ms": result.latency_ms,
        "model": result.model,
    }


@router.post("/ask")
async def voice_ask(
    audio: UploadFile = File(...),
    machine_id: str = Form(...),
    language: str = Form("hi"),
    speak: bool = Form(True),
    slow: bool = Form(False),
    operator: dict = Depends(security.current_operator),
) -> dict:
    """Full round trip, with a per-stage timing breakdown."""
    raw = await audio.read()
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Audio too large")

    timings: dict[str, float] = {}

    started = time.perf_counter()
    transcript = stt.transcribe(raw, language=language)
    timings["stt_ms"] = round((time.perf_counter() - started) * 1000, 1)

    if transcript is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Speech recognition is not available. Run scripts/download_models.py, or type the question instead.",
        )
    if not transcript.text.strip():
        return {
            "transcript": "",
            "empty": True,
            "message_hi": "मुझे कुछ सुनाई नहीं दिया। कृपया दोबारा बोलिए।",
            "message_en": "I did not hear anything. Please say that again.",
            "timings": timings,
        }

    started = time.perf_counter()
    try:
        result = assistant_service.ask(
            operator_id=operator["id"],
            machine_id=machine_id,
            text=transcript.text,
            language=language,
            source="voice",
        )
    except KeyError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown machine")
    timings["reason_ms"] = round((time.perf_counter() - started) * 1000, 1)

    result["transcript"] = transcript.text
    result["stt"] = {"duration_s": transcript.duration_s, "model": transcript.model}

    if speak:
        spoken = result["reply"]["speech"].get(language) or result["reply"]["text"].get(language, "")
        started = time.perf_counter()
        speech = tts.synthesize(spoken, language=language, slow=slow)
        timings["tts_ms"] = round((time.perf_counter() - started) * 1000, 1)
        if speech is not None:
            result["audio"] = {
                "base64": base64.b64encode(speech.wav).decode("ascii"),
                "mime": "audio/wav",
                "sample_rate": speech.sample_rate,
                "duration_s": speech.duration_s,
                "engine": speech.engine,
            }
        else:
            result["audio"] = None
            result["speech_fallback_text"] = tts.prepare(spoken, language=language, slow=slow)

    timings["total_ms"] = round(sum(timings.values()), 1)
    result["timings"] = timings
    return result


@router.post("/speak")
def speak(payload: SpeakRequest, _: dict = Depends(security.current_operator)) -> Response:
    """Text to a WAV stream - used by the 'read my tasks aloud' button."""
    speech = tts.synthesize(payload.text, language=payload.language, slow=payload.slow)
    if speech is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Text to speech is not available. Run scripts/download_models.py.",
        )
    return Response(
        content=speech.wav,
        media_type="audio/wav",
        headers={
            "X-TTS-Engine": speech.engine,
            "X-TTS-Latency-Ms": str(speech.latency_ms),
            "X-TTS-Cached": "1" if speech.cached else "0",
            "Cache-Control": "no-store",
        },
    )


@router.post("/translate")
def do_translate(payload: TranslateRequest, _: dict = Depends(security.current_operator)) -> dict:
    result = translate.translate(payload.text, source=payload.source, target=payload.target)
    if result is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Translation model is not available")
    return {
        "text": result.text,
        "source": result.source_language,
        "target": result.target_language,
        "engine": result.engine,
        "cached": result.cached,
        "latency_ms": result.latency_ms,
    }
