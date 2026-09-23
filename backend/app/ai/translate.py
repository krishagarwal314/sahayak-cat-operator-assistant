"""English -> Hindi translation for manager-authored task text.

The manager writes tasks in English. The operator hears them in Hindi. That is
the only place in the system where free-form machine translation is needed -
every assistant reply is generated from Hindi templates instead, which keeps the
spoken output grammatical and predictable.

Supports IndicTrans2 (best quality for en->hi at a small size) and NLLB, chosen
automatically from TRANSLATE_MODEL. Results are memoised because the task list
is static across a shift.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from ..config import settings
from . import registry

log = logging.getLogger("sahayak.translate")

_KEY = "translate"
_MEMO: dict[tuple[str, str, str], str] = {}

_NLLB_CODES = {"hi": "hin_Deva", "en": "eng_Latn", "mr": "mar_Deva", "ta": "tam_Taml",
               "te": "tel_Telu", "bn": "ben_Beng", "gu": "guj_Gujr", "kn": "kan_Knda"}
_INDICTRANS_CODES = {"hi": "hin_Deva", "en": "eng_Latn", "mr": "mar_Deva", "ta": "tam_Taml",
                     "te": "tel_Telu", "bn": "ben_Beng", "gu": "guj_Gujr", "kn": "kan_Knda"}


@dataclass
class Translation:
    text: str
    source_language: str
    target_language: str
    latency_ms: float
    engine: str
    cached: bool = False


def _family() -> str:
    name = settings.translate_model.lower()
    if "indictrans" in name:
        return "indictrans2"
    if "nllb" in name:
        return "nllb"
    return "marian"


def _load():
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    device = registry.resolve_device()
    name = settings.translate_model
    family = _family()

    kwargs = {"trust_remote_code": True} if family == "indictrans2" else {}
    tokenizer = AutoTokenizer.from_pretrained(name, **kwargs)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        name, torch_dtype=registry.resolve_dtype(device), **kwargs
    )
    model.to(device).eval()

    processor = None
    if family == "indictrans2":
        try:
            from IndicTransToolkit.processor import IndicProcessor

            processor = IndicProcessor(inference=True)
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "IndicTransToolkit not installed (%s). Install it with "
                "`pip install IndicTransToolkit` for correct IndicTrans2 output.",
                exc,
            )

    return {"tokenizer": tokenizer, "model": model, "device": device,
            "family": family, "processor": processor, "torch": torch}


def available() -> bool:
    if not settings.enable_translate:
        return False
    return registry.get(_KEY, _load) is not None


def translate(text: str, *, source: str = "en", target: str = "hi") -> Translation | None:
    text = (text or "").strip()
    if not text:
        return None
    if source == target:
        return Translation(text, source, target, 0.0, "identity", cached=True)
    if not settings.enable_translate:
        return None

    key = (text, source, target)
    if key in _MEMO:
        return Translation(_MEMO[key], source, target, 0.0, _family(), cached=True)

    bundle = registry.get(_KEY, _load)
    if bundle is None:
        return None

    started = time.perf_counter()
    torch, tokenizer, model = bundle["torch"], bundle["tokenizer"], bundle["model"]
    family = bundle["family"]

    try:
        if family == "indictrans2":
            src_code = _INDICTRANS_CODES.get(source, "eng_Latn")
            tgt_code = _INDICTRANS_CODES.get(target, "hin_Deva")
            processor = bundle["processor"]
            batch = processor.preprocess_batch([text], src_lang=src_code, tgt_lang=tgt_code) if processor else [text]
            enc = tokenizer(batch, truncation=True, padding="longest", return_tensors="pt", max_length=256)
            enc = {k: v.to(bundle["device"]) for k, v in enc.items()}
            with torch.inference_mode():
                generated = model.generate(**enc, max_length=256, num_beams=5, min_length=0)
            decoded = tokenizer.batch_decode(generated, skip_special_tokens=True)
            out = processor.postprocess_batch(decoded, lang=tgt_code)[0] if processor else decoded[0]

        elif family == "nllb":
            tokenizer.src_lang = _NLLB_CODES.get(source, "eng_Latn")
            enc = tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
            enc = {k: v.to(bundle["device"]) for k, v in enc.items()}
            tgt_token = _NLLB_CODES.get(target, "hin_Deva")
            forced = tokenizer.convert_tokens_to_ids(tgt_token)
            with torch.inference_mode():
                generated = model.generate(**enc, forced_bos_token_id=forced, max_length=256, num_beams=4)
            out = tokenizer.batch_decode(generated, skip_special_tokens=True)[0]

        else:  # Marian opus-mt, language pair is baked into the checkpoint
            enc = tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
            enc = {k: v.to(bundle["device"]) for k, v in enc.items()}
            with torch.inference_mode():
                generated = model.generate(**enc, max_length=256, num_beams=4)
            out = tokenizer.batch_decode(generated, skip_special_tokens=True)[0]
    except Exception as exc:  # noqa: BLE001
        log.warning("translation failed: %s", exc)
        return None

    out = out.strip()
    _MEMO[key] = out
    return Translation(out, source, target, round((time.perf_counter() - started) * 1000, 1), family)


def translate_many(texts: list[str], *, source: str = "en", target: str = "hi") -> list[str | None]:
    return [(t.text if (t := translate(x, source=source, target=target)) else None) for x in texts]


def info() -> dict:
    return {
        "model": settings.translate_model,
        "family": _family(),
        "enabled": settings.enable_translate,
        "cached_phrases": len(_MEMO),
    }
