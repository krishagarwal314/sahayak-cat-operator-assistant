"""Stage L3 - the fine-tuned intent classifier.

This is the only model in the project we train ourselves. Until
`python -m app.ai.intent.train` has produced a checkpoint the stage reports
itself unavailable and the router simply skips it, so the assistant is fully
functional before training and gets sharper afterwards.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from ...config import settings
from .. import registry

log = logging.getLogger("sahayak.intent.classifier")

_KEY = "intent_classifier"


@dataclass
class ClassifierHit:
    intent: str
    score: float
    margin: float
    top_k: list[tuple[str, float]]


def _load():
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    path = settings.intent_model_dir
    if not path.exists() or not (path / "config.json").exists():
        raise FileNotFoundError(f"no fine-tuned intent classifier at {path}")

    device = registry.resolve_device()
    tokenizer = AutoTokenizer.from_pretrained(str(path))
    # The exported model is stored in half precision to keep the download small;
    # load it as float32 so it runs correctly on CPU as well as GPU.
    model = AutoModelForSequenceClassification.from_pretrained(str(path), torch_dtype=torch.float32)
    model.to(device).eval()

    labels_file = path / "labels.json"
    if labels_file.exists():
        id2label = {int(k): v for k, v in json.loads(labels_file.read_text()).items()}
    else:
        id2label = {int(k): v for k, v in model.config.id2label.items()}

    return {"tokenizer": tokenizer, "model": model, "device": device, "id2label": id2label, "torch": torch}


def available() -> bool:
    return registry.get(_KEY, _load) is not None


def predict(text: str, *, allowed: set[str] | None = None, top_k: int = 3) -> ClassifierHit | None:
    bundle = registry.get(_KEY, _load)
    if bundle is None or not text.strip():
        return None

    torch = bundle["torch"]
    enc = bundle["tokenizer"](text, truncation=True, max_length=64, return_tensors="pt")
    enc = {k: v.to(bundle["device"]) for k, v in enc.items()}
    with torch.inference_mode():
        logits = bundle["model"](**enc).logits[0]
    probs = torch.softmax(logits.float(), dim=-1).cpu().tolist()

    scored = [(bundle["id2label"].get(i, str(i)), p) for i, p in enumerate(probs)]
    if allowed is not None:
        filtered = [(name, p) for name, p in scored if name in allowed or name == "UNKNOWN"]
        if filtered:
            scored = filtered
    scored.sort(key=lambda x: x[1], reverse=True)

    top = scored[:top_k]
    margin = top[0][1] - top[1][1] if len(top) > 1 else top[0][1]
    return ClassifierHit(intent=top[0][0], score=top[0][1], margin=margin, top_k=top)


def info() -> dict:
    return {
        "available": _KEY in registry._CACHE,  # noqa: SLF001 - internal status only
        "path": str(settings.intent_model_dir),
        "base_model": settings.intent_base_model,
        "trained": settings.intent_model_dir.exists(),
    }
