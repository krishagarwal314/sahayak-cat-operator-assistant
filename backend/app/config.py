"""Central configuration.

Every model is swappable through environment variables so the same code runs on
a laptop (MODEL_PROFILE=lite) and on a GPU box (MODEL_PROFILE=full) without any
source change.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = BASE_DIR.parent
REPO_DIR = BACKEND_DIR.parent


def _env(key: str, default: str) -> str:
    value = os.environ.get(key)
    return value if value else default


def _flag(key: str, default: bool) -> bool:
    raw = os.environ.get(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# --------------------------------------------------------------------------
# Model profiles
# --------------------------------------------------------------------------
# "balanced" is the default: every model is a proven Hindi performer and none of
# them is huge (~3.5 GB total on disk). "lite" trades quality for a ~1.2 GB
# footprint. "quality" pulls the heavier checkpoints for a GPU machine.
PROFILES: dict[str, dict[str, str]] = {
    "lite": {
        "stt": "openai/whisper-small",
        "tts": "facebook/mms-tts-hin",
        "translate": "facebook/nllb-200-distilled-600M",
        "embedder": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        "intent_base": "ai4bharat/indic-bert",
    },
    "balanced": {
        # Hindi fine-tuned Whisper - far better on Hindi than vanilla whisper-small
        # at the same 244M size.
        "stt": "vasista22/whisper-hindi-small",
        # VITS, 145M, streams instantly on CPU. Set TTS_MODEL=ai4bharat/IndicF5
        # for the higher fidelity (but heavier, reference-audio driven) option.
        "tts": "facebook/mms-tts-hin",
        # NLLB rather than the (better) IndicTrans2, for one blunt reason:
        # IndicTrans2 ships trust_remote_code that imports transformers.onnx,
        # which was removed in transformers v5, so it cannot load there at all.
        # NLLB is native, ungated, and needs no extra toolkit.
        # For IndicTrans2 quality, pin transformers<5 and set:
        #   TRANSLATE_MODEL=ai4bharat/indictrans2-en-indic-dist-200M
        "translate": "facebook/nllb-200-distilled-600M",
        "embedder": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        # 238M, trained on 17 Indian languages incl. transliterated Hinglish.
        "intent_base": "google/muril-base-cased",
    },
    "quality": {
        "stt": "vasista22/whisper-hindi-medium",
        "tts": "ai4bharat/IndicF5",
        # Same transformers v5 constraint as above - see the balanced profile.
        "translate": "facebook/nllb-200-distilled-1.3B",
        "embedder": "intfloat/multilingual-e5-base",
        "intent_base": "google/muril-base-cased",
    },
}

MODEL_PROFILE = _env("MODEL_PROFILE", "balanced").lower()
if MODEL_PROFILE not in PROFILES:
    MODEL_PROFILE = "balanced"
_P = PROFILES[MODEL_PROFILE]


class Settings:
    """Runtime settings. Read once at import, overridable via env."""

    app_name = "Sahayak - Smart Operator Assistant for CAT Machines"
    version = "1.0.0"

    # ---- server ----
    host = _env("HOST", "0.0.0.0")
    port = int(_env("PORT", "8000"))
    cors_origins = [o.strip() for o in _env("CORS_ORIGINS", "*").split(",")]

    # ---- auth ----
    jwt_secret = _env("JWT_SECRET", "sahayak-dev-secret-change-in-production")
    jwt_algorithm = "HS256"
    jwt_ttl_minutes = int(_env("JWT_TTL_MINUTES", "720"))

    # ---- models ----
    profile = MODEL_PROFILE
    stt_model = _env("STT_MODEL", _P["stt"])
    tts_model = _env("TTS_MODEL", _P["tts"])
    translate_model = _env("TRANSLATE_MODEL", _P["translate"])
    embedder_model = _env("EMBEDDER_MODEL", _P["embedder"])
    intent_base_model = _env("INTENT_BASE_MODEL", _P["intent_base"])

    # Directory holding the fine-tuned intent classifier (produced by
    # `python -m app.ai.intent.train`). Absent => router skips the L3 stage.
    intent_model_dir = Path(_env("INTENT_MODEL_DIR", str(BACKEND_DIR / "models" / "intent-classifier")))

    models_cache = Path(_env("HF_HOME", str(Path.home() / ".cache" / "huggingface")))
    device = _env("DEVICE", "auto")  # auto | cpu | cuda
    torch_dtype = _env("TORCH_DTYPE", "auto")

    # ---- feature switches ----
    # With models disabled the API still works end to end: STT/TTS/translate fall
    # back to deterministic stubs. Handy for UI work and for CI.
    enable_stt = _flag("ENABLE_STT", True)
    enable_tts = _flag("ENABLE_TTS", True)
    enable_translate = _flag("ENABLE_TRANSLATE", True)
    enable_embedder = _flag("ENABLE_EMBEDDER", True)
    eager_load = _flag("EAGER_LOAD_MODELS", False)

    # ---- intent router thresholds ----
    rule_min_score = float(_env("RULE_MIN_SCORE", "0.62"))
    embed_accept = float(_env("EMBED_ACCEPT", "0.58"))
    embed_margin = float(_env("EMBED_MARGIN", "0.045"))
    classifier_accept = float(_env("CLASSIFIER_ACCEPT", "0.70"))

    # ---- audio ----
    sample_rate = 16000
    tts_sample_rate = int(_env("TTS_SAMPLE_RATE", "24000"))
    indicf5_ref_audio = _env("INDICF5_REF_AUDIO", str(BACKEND_DIR / "assets" / "ref_audio" / "hindi_ref.wav"))
    indicf5_ref_text = _env(
        "INDICF5_REF_TEXT",
        "नमस्ते, मैं आपकी मशीन सहायक हूँ और आपकी मदद के लिए हमेशा तैयार हूँ।",
    )

    # ---- paths ----
    seed_dir = BASE_DIR / "seed"
    assets_dir = BACKEND_DIR / "assets"
    default_language = _env("DEFAULT_LANGUAGE", "hi")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
