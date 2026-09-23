"""Sentence embeddings via plain transformers (no sentence-transformers dep).

Mean pooling over the last hidden state with attention masking, then L2
normalisation - exactly what the sentence-transformers wrapper does for the
MiniLM/E5 family, but without pulling in the extra package.
"""

from __future__ import annotations

import logging

from ..config import settings
from . import registry

log = logging.getLogger("sahayak.embeddings")

_KEY = "embedder"
# E5 models expect these prefixes; MiniLM ignores them harmlessly if absent.
_NEEDS_PREFIX = ("e5", "gte")


def _load():
    import torch
    from transformers import AutoModel, AutoTokenizer

    device = registry.resolve_device()
    name = settings.embedder_model
    tokenizer = AutoTokenizer.from_pretrained(name)
    model = AutoModel.from_pretrained(name, torch_dtype=registry.resolve_dtype(device))
    model.to(device).eval()
    return {"tokenizer": tokenizer, "model": model, "device": device, "torch": torch, "name": name}


def available() -> bool:
    if not settings.enable_embedder:
        return False
    return registry.get(_KEY, _load) is not None


def _prefix(bundle: dict, text: str, kind: str) -> str:
    if any(tag in bundle["name"].lower() for tag in _NEEDS_PREFIX):
        return f"{kind}: {text}"
    return text


def encode(texts: list[str], *, kind: str = "query", batch_size: int = 32):
    """Return an (n, d) float32 numpy array of L2 normalised embeddings."""
    if not settings.enable_embedder:
        return None
    bundle = registry.get(_KEY, _load)
    if bundle is None or not texts:
        return None

    torch = bundle["torch"]
    tokenizer, model, device = bundle["tokenizer"], bundle["model"], bundle["device"]
    prepared = [_prefix(bundle, t, kind) for t in texts]

    chunks = []
    with torch.inference_mode():
        for start in range(0, len(prepared), batch_size):
            batch = prepared[start : start + batch_size]
            enc = tokenizer(batch, padding=True, truncation=True, max_length=96, return_tensors="pt")
            enc = {k: v.to(device) for k, v in enc.items()}
            out = model(**enc).last_hidden_state
            mask = enc["attention_mask"].unsqueeze(-1).to(out.dtype)
            pooled = (out * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
            pooled = torch.nn.functional.normalize(pooled.float(), p=2, dim=1)
            chunks.append(pooled.cpu())
    return torch.cat(chunks, dim=0).numpy()


def encode_one(text: str, *, kind: str = "query"):
    result = encode([text], kind=kind)
    return None if result is None else result[0]
