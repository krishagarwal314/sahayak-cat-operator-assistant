"""Text to speech for Hindi.

Two engines behind one interface, chosen by TTS_MODEL:

  facebook/mms-tts-hin  (default)  VITS, 145M, synthesises a sentence in well
                                   under a second on CPU. Never needs a prompt.
  ai4bharat/IndicF5                Flow-matching TTS with far more natural
                                   prosody. It is a voice-cloning model, so it
                                   needs a short reference clip plus the exact
                                   text of that clip.

If neither is available the caller gets None and the browser falls back to the
Web Speech API, so the demo still speaks.
"""

from __future__ import annotations

import io
import logging
import time
from dataclasses import dataclass

from ..config import settings
from . import registry

log = logging.getLogger("saathi.tts")

_KEY = "tts"


@dataclass
class Speech:
    wav: bytes
    sample_rate: int
    duration_s: float
    latency_ms: float
    engine: str
    model: str


def _is_indicf5() -> bool:
    return "indicf5" in settings.tts_model.lower()


def _load():
    import torch

    device = registry.resolve_device()

    if _is_indicf5():
        from transformers import AutoModel

        model = AutoModel.from_pretrained(settings.tts_model, trust_remote_code=True)
        model.to(device)
        return {"engine": "indicf5", "model": model, "device": device, "torch": torch}

    from transformers import AutoTokenizer, VitsModel

    tokenizer = AutoTokenizer.from_pretrained(settings.tts_model)
    model = VitsModel.from_pretrained(settings.tts_model)
    model.to(device).eval()
    return {
        "engine": "vits",
        "model": model,
        "tokenizer": tokenizer,
        "device": device,
        "torch": torch,
        "sample_rate": int(model.config.sampling_rate),
    }


def available() -> bool:
    if not settings.enable_tts:
        return False
    return registry.get(_KEY, _load) is not None


def _to_wav_bytes(audio, sample_rate: int) -> bytes:
    import numpy as np
    import soundfile as sf

    audio = np.asarray(audio, dtype="float32").squeeze()
    peak = float(np.abs(audio).max()) if audio.size else 0.0
    if peak > 1.0:
        audio = audio / peak
    buffer = io.BytesIO()
    sf.write(buffer, audio, sample_rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def _synth_vits(bundle: dict, text: str, rate: float):
    torch = bundle["torch"]
    model = bundle["model"]
    # VitsModel divides predicted durations by speaking_rate, so < 1.0 is slower.
    model.speaking_rate = rate
    inputs = bundle["tokenizer"](text, return_tensors="pt")
    if inputs["input_ids"].shape[-1] == 0:
        return None, bundle["sample_rate"]
    inputs = {k: v.to(bundle["device"]) for k, v in inputs.items()}
    with torch.inference_mode():
        output = model(**inputs).waveform
    return output.float().cpu().numpy().squeeze(), bundle["sample_rate"]


def _synth_indicf5(bundle: dict, text: str):
    import numpy as np

    ref_audio = settings.indicf5_ref_audio
    audio = bundle["model"](text, ref_audio_path=ref_audio, ref_text=settings.indicf5_ref_text)
    audio = np.asarray(audio, dtype="float32").squeeze()
    # IndicF5 returns int16-scaled floats in some builds.
    if audio.size and float(np.abs(audio).max()) > 1.5:
        audio = audio / 32768.0
    return audio, 24000


def prepare(text: str, *, language: str = "hi", slow: bool = False) -> str:
    """The exact string the model will be asked to read."""
    if language != "hi":
        return (text or "").strip()
    from ..services.speech_text import to_speech

    return to_speech(text, slow=slow)


def synthesize(text: str, *, language: str = "hi", slow: bool = False) -> Speech | None:
    """Render a reply to WAV bytes.

    Hindi text is first rewritten into pure spoken Devanagari (MMS-TTS was
    trained on nothing else, so digits, Latin letters and symbols were being
    skipped or mangled). It is then synthesised one sentence at a time with a
    real silence between sentences: VITS drifts and rushes on long inputs, and
    the gaps give a listener time to take each point in before the next.
    """
    import numpy as np

    from ..services.speech_text import phrases

    text = prepare(text, language=language, slow=slow)
    if not text or not settings.enable_tts:
        return None
    bundle = registry.get(_KEY, _load)
    if bundle is None:
        return None

    rate = settings.tts_slow_rate if slow else settings.tts_speaking_rate
    gap_s = settings.tts_slow_sentence_gap if slow else settings.tts_sentence_gap

    started = time.perf_counter()
    try:
        if bundle["engine"] == "indicf5":
            audio, sample_rate = _synth_indicf5(bundle, text)
        else:
            chunks = []
            sample_rate = bundle["sample_rate"]
            long_gap = np.zeros(int(sample_rate * gap_s), dtype="float32")
            short_gap = np.zeros(int(sample_rate * gap_s * 0.45), dtype="float32")
            for phrase, pause in phrases(text) or [(text, "long")]:
                wave, sample_rate = _synth_vits(bundle, phrase, rate)
                if wave is None or not getattr(wave, "size", 0):
                    continue
                chunks.extend([
                    np.asarray(wave, dtype="float32").reshape(-1),
                    long_gap if pause == "long" else short_gap,
                ])
            if not chunks:
                return None
            audio = np.concatenate(chunks[:-1])
    except Exception as exc:  # noqa: BLE001 - never let TTS break a reply
        log.warning("tts synthesis failed: %s", exc)
        return None

    wav = _to_wav_bytes(audio, sample_rate)
    return Speech(
        wav=wav,
        sample_rate=sample_rate,
        duration_s=round(len(audio) / sample_rate, 2) if sample_rate else 0.0,
        latency_ms=round((time.perf_counter() - started) * 1000, 1),
        engine=bundle["engine"],
        model=settings.tts_model,
    )


def info() -> dict:
    return {
        "model": settings.tts_model,
        "engine": "indicf5" if _is_indicf5() else "vits",
        "enabled": settings.enable_tts,
        "needs_reference_audio": _is_indicf5(),
        "reference_audio": settings.indicf5_ref_audio if _is_indicf5() else None,
    }
