"""Lazy model registry.

Models are heavy and the demo must boot instantly, so nothing is loaded at
import time. Each accessor loads on first use, caches the result, and returns
None if the model is unavailable (not downloaded, torch missing, disabled by
env). Every caller is written to degrade gracefully when it gets None, which is
what lets the whole API run end to end on a laptop with no models at all.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from ..config import settings

log = logging.getLogger("sahayak.registry")

_LOCK = threading.RLock()
_CACHE: dict[str, Any] = {}
_FAILED: dict[str, str] = {}
_LOAD_MS: dict[str, float] = {}


def resolve_device() -> str:
    if settings.device != "auto":
        return settings.device
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:  # pragma: no cover - torch not installed
        pass
    return "cpu"


def resolve_dtype(device: str):
    try:
        import torch
    except Exception:  # pragma: no cover
        return None
    if settings.torch_dtype != "auto":
        return getattr(torch, settings.torch_dtype, None)
    return torch.float16 if device == "cuda" else torch.float32


def _load(key: str, loader) -> Any:
    """Load once, remember failures so we do not retry on every request."""
    if key in _CACHE:
        return _CACHE[key]
    if key in _FAILED:
        return None
    with _LOCK:
        if key in _CACHE:
            return _CACHE[key]
        if key in _FAILED:
            return None
        started = time.perf_counter()
        try:
            obj = loader()
        except Exception as exc:  # noqa: BLE001 - any failure must degrade, not crash
            _FAILED[key] = f"{type(exc).__name__}: {exc}"
            log.warning("model '%s' unavailable -> %s", key, _FAILED[key])
            return None
        elapsed = (time.perf_counter() - started) * 1000
        _LOAD_MS[key] = elapsed
        _CACHE[key] = obj
        log.info("model '%s' loaded in %.0f ms", key, elapsed)
        return obj


def get(key: str, loader) -> Any:
    return _load(key, loader)


def status() -> dict:
    """Surfaced on /api/system/models so the UI can show what is live."""
    return {
        "profile": settings.profile,
        "device": resolve_device(),
        "loaded": {k: round(_LOAD_MS.get(k, 0.0), 1) for k in sorted(_CACHE)},
        "failed": dict(_FAILED),
        "configured": {
            "stt": settings.stt_model,
            "tts": settings.tts_model,
            "tts_en": settings.tts_model_en,
            "translate": settings.translate_model,
            "embedder": settings.embedder_model,
            "intent_base": settings.intent_base_model,
        },
        "enabled": {
            "stt": settings.enable_stt,
            "tts": settings.enable_tts,
            "translate": settings.enable_translate,
            "embedder": settings.enable_embedder,
        },
    }


def reset() -> None:
    """Drop every cached model. Used by tests and the /api/system/reload hook."""
    with _LOCK:
        _CACHE.clear()
        _FAILED.clear()
        _LOAD_MS.clear()
