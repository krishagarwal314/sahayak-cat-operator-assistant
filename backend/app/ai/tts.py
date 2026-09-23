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

import hashlib
import io
import logging
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass

from ..config import settings
from . import registry

log = logging.getLogger("saathi.tts")

# Registry keys per language. Hindi keeps the plain "tts" key that the status
# page and the self check already look for.
_KEYS = {"hi": "tts", "en": "tts_en"}


@dataclass
class Speech:
    wav: bytes
    sample_rate: int
    duration_s: float
    latency_ms: float
    engine: str
    model: str
    cached: bool = False


# --------------------------------------------------------------------------
# cache
# --------------------------------------------------------------------------
# The same sentences are spoken again and again: page intros, guide steps,
# safety rules, "fuel is at ..." for a machine that has not moved. Synthesis
# is deterministic for a given text, voice and speed, so each clip is made
# once, kept in memory, and written to disk so it survives a restart.
_MEMORY: OrderedDict[str, Speech] = OrderedDict()
_LOCK = threading.Lock()
_STATS = {"hits": 0, "disk_hits": 0, "misses": 0}


def _cache_key(text: str, language: str, slow: bool) -> str:
    rate = settings.tts_slow_rate if slow else settings.tts_speaking_rate
    gap = settings.tts_slow_sentence_gap if slow else settings.tts_sentence_gap
    raw = f"{_model_for(language)}|{language}|{rate}|{gap}|{text}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _remember(key: str, speech: Speech) -> None:
    with _LOCK:
        _MEMORY[key] = speech
        _MEMORY.move_to_end(key)
        while len(_MEMORY) > settings.tts_cache_items:
            _MEMORY.popitem(last=False)


def _cached(key: str, language: str) -> Speech | None:
    with _LOCK:
        hit = _MEMORY.get(key)
        if hit is not None:
            _MEMORY.move_to_end(key)
            _STATS["hits"] += 1
            return hit
    path = settings.tts_cache_dir / f"{key}.wav"
    if not path.exists():
        return None
    try:
        import soundfile as sf

        wav = path.read_bytes()
        info_ = sf.info(io.BytesIO(wav))
        speech = Speech(wav=wav, sample_rate=info_.samplerate, duration_s=round(info_.duration, 2),
                        latency_ms=0.0, engine="cache", model=_model_for(language), cached=True)
    except Exception:  # noqa: BLE001 - a bad file is just a miss
        return None
    _STATS["disk_hits"] += 1
    _remember(key, speech)
    return speech


def _store(key: str, speech: Speech) -> None:
    _remember(key, Speech(**{**speech.__dict__, "cached": True, "latency_ms": 0.0}))
    try:
        settings.tts_cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = settings.tts_cache_dir / f"{key}.tmp"
        tmp.write_bytes(speech.wav)
        tmp.replace(settings.tts_cache_dir / f"{key}.wav")
    except OSError as exc:
        log.debug("tts cache write failed: %s", exc)


def cache_stats() -> dict:
    files = list(settings.tts_cache_dir.glob("*.wav")) if settings.tts_cache_dir.exists() else []
    return {**_STATS, "memory_items": len(_MEMORY), "disk_items": len(files),
            "disk_mb": round(sum(f.stat().st_size for f in files) / 1e6, 1)}


def _is_indicf5() -> bool:
    return "indicf5" in settings.tts_model.lower()


def _phonemizer_works() -> bool:
    """True if espeak can actually turn text into phonemes on this machine."""
    try:
        from phonemizer import phonemize

        return bool(phonemize("machine", language="en-us", backend="espeak", strip=True))
    except Exception:  # noqa: BLE001 - package missing, or espeak library missing
        return False


def _model_for(language: str) -> str:
    return settings.tts_model_en if language == "en" else settings.tts_model


def _loader(language: str):
    return lambda: _load(language)


def _load(language: str = "hi"):
    import torch

    device = registry.resolve_device()
    name = _model_for(language)

    if language != "en" and _is_indicf5():
        from transformers import AutoModel

        model = AutoModel.from_pretrained(settings.tts_model, trust_remote_code=True)
        model.to(device)
        return {"engine": "indicf5", "model": model, "device": device, "torch": torch}

    from transformers import AutoTokenizer, VitsModel

    if language == "en" and not _phonemizer_works():
        # The phoneme-based English voice needs espeak. Without it, fall back to
        # the letter-based MMS voice rather than having no English at all.
        log.warning("espeak/phonemizer unavailable - English voice falling back to %s. "
                    "Fix: apt-get install -y espeak-ng && pip install phonemizer",
                    settings.tts_model_en_fallback)
        name = settings.tts_model_en_fallback

    tokenizer = AutoTokenizer.from_pretrained(name)
    model = VitsModel.from_pretrained(name)
    model.to(device).eval()
    return {
        "engine": "vits",
        "model": model,
        "tokenizer": tokenizer,
        "device": device,
        "torch": torch,
        "sample_rate": int(model.config.sampling_rate),
    }


def available(language: str = "hi") -> bool:
    if not settings.enable_tts:
        return False
    language = "en" if language == "en" else "hi"
    return registry.get(_KEYS[language], _loader(language)) is not None


def available_en() -> bool:
    return available("en")


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
    from ..services.speech_text import to_speech, to_speech_en

    if language == "en":
        return to_speech_en(text, slow=slow)
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

    language = "en" if language == "en" else "hi"
    text = prepare(text, language=language, slow=slow)
    if not text or not settings.enable_tts:
        return None
    key = _cache_key(text, language, slow)
    hit = _cached(key, language)
    if hit is not None:
        return hit
    bundle = registry.get(_KEYS[language], _loader(language))
    if bundle is None:
        return None
    _STATS["misses"] += 1

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
    speech = Speech(
        wav=wav,
        sample_rate=sample_rate,
        duration_s=round(len(audio) / sample_rate, 2) if sample_rate else 0.0,
        latency_ms=round((time.perf_counter() - started) * 1000, 1),
        engine=bundle["engine"],
        model=_model_for(language),
    )
    _store(key, speech)
    return speech


def warm(texts: list[tuple[str, str, bool]]) -> int:
    """Synthesise (text, language, slow) triples ahead of time; returns how many were new."""
    made = 0
    for text, language, slow in texts:
        before = _STATS["misses"]
        synthesize(text, language=language, slow=slow)
        made += _STATS["misses"] - before
    return made


def info() -> dict:
    return {
        "model": settings.tts_model,
        "model_en": settings.tts_model_en,
        "engine": "indicf5" if _is_indicf5() else "vits",
        "enabled": settings.enable_tts,
        "needs_reference_audio": _is_indicf5(),
        "reference_audio": settings.indicf5_ref_audio if _is_indicf5() else None,
        "cache": cache_stats(),
    }
