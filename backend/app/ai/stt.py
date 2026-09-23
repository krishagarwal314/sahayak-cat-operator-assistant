"""Speech to text for Hindi (and the other Indic languages the model covers).

Default checkpoint is a Hindi fine-tuned Whisper, which is dramatically better on
Indian-accented Hindi than vanilla multilingual Whisper of the same size.

Audio arrives from the browser's MediaRecorder as webm/opus, which soundfile
cannot read, so we fall back to ffmpeg for anything it refuses.
"""

from __future__ import annotations

import io
import logging
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from ..config import settings
from . import registry

log = logging.getLogger("sahayak.stt")

_KEY = "stt"
TARGET_SR = 16000


@dataclass
class Transcript:
    text: str
    language: str
    duration_s: float
    latency_ms: float
    model: str
    engine: str = "whisper"


def _load():
    import torch
    from transformers import pipeline

    device = registry.resolve_device()
    dtype = registry.resolve_dtype(device)
    pipe = pipeline(
        "automatic-speech-recognition",
        model=settings.stt_model,
        torch_dtype=dtype,
        device=0 if device == "cuda" else -1,
        chunk_length_s=30,
    )
    return {"pipe": pipe, "device": device, "torch": torch}


def available() -> bool:
    if not settings.enable_stt:
        return False
    return registry.get(_KEY, _load) is not None


# --------------------------------------------------------------------------
# audio decoding
# --------------------------------------------------------------------------
def _decode_with_soundfile(raw: bytes):
    import numpy as np
    import soundfile as sf

    data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    if sr != TARGET_SR:
        mono = _resample(mono, sr, TARGET_SR)
    return mono.astype("float32"), TARGET_SR


def _decode_with_ffmpeg(raw: bytes):
    import numpy as np

    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required to decode browser audio (webm/opus)")

    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as src:
        src.write(raw)
        src_path = Path(src.name)
    try:
        proc = subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", str(src_path),
             "-f", "f32le", "-ac", "1", "-ar", str(TARGET_SR), "-"],
            capture_output=True,
            check=True,
        )
        audio = np.frombuffer(proc.stdout, dtype="float32").copy()
        return audio, TARGET_SR
    finally:
        src_path.unlink(missing_ok=True)


def _resample(audio, src_sr: int, dst_sr: int):
    import numpy as np

    if src_sr == dst_sr:
        return audio
    duration = audio.shape[0] / src_sr
    target_len = int(round(duration * dst_sr))
    return np.interp(
        np.linspace(0.0, duration, target_len, endpoint=False),
        np.linspace(0.0, duration, audio.shape[0], endpoint=False),
        audio,
    ).astype("float32")


def decode_audio(raw: bytes):
    """bytes of any common container -> (float32 mono @16k, sample_rate)."""
    try:
        return _decode_with_soundfile(raw)
    except Exception:  # noqa: BLE001 - webm/opus lands here, which is expected
        return _decode_with_ffmpeg(raw)


# --------------------------------------------------------------------------
# transcription
# --------------------------------------------------------------------------
def transcribe(raw_audio: bytes, *, language: str = "hi") -> Transcript | None:
    """None means STT is unavailable - the caller should ask for typed input."""
    if not settings.enable_stt:
        return None
    bundle = registry.get(_KEY, _load)
    if bundle is None:
        return None

    started = time.perf_counter()
    audio, sr = decode_audio(raw_audio)
    duration = len(audio) / sr if sr else 0.0
    if duration < 0.25:
        return Transcript("", language, duration, 0.0, settings.stt_model)

    generate_kwargs = {"task": "transcribe"}
    # Hindi fine-tuned checkpoints are single language and reject a language arg.
    if "hindi" not in settings.stt_model.lower():
        generate_kwargs["language"] = language

    try:
        out = bundle["pipe"]({"raw": audio, "sampling_rate": sr}, generate_kwargs=generate_kwargs)
    except (ValueError, TypeError):
        out = bundle["pipe"]({"raw": audio, "sampling_rate": sr})

    text = (out.get("text") or "").strip() if isinstance(out, dict) else str(out).strip()
    return Transcript(
        text=text,
        language=language,
        duration_s=round(duration, 2),
        latency_ms=round((time.perf_counter() - started) * 1000, 1),
        model=settings.stt_model,
    )


def info() -> dict:
    return {"model": settings.stt_model, "enabled": settings.enable_stt, "sample_rate": TARGET_SR}
