"""Stage L2 - semantic nearest-neighbour over a prototype bank.

Every taxonomy example is encoded once into a bank of prototypes. An unseen
utterance is matched against that bank by cosine similarity, blending the single
best neighbour with the intent centroid: the max term catches paraphrases of one
specific phrasing, the centroid term stops a single odd example from dragging an
intent in.

The bank is cached on disk and keyed by (embedder model, taxonomy contents), so
editing taxonomy.py automatically invalidates it.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path

from ...config import BACKEND_DIR, settings
from .. import embeddings
from .taxonomy import INTENTS

log = logging.getLogger("sahayak.intent.embedder")

CACHE_DIR = BACKEND_DIR / "models" / "prototypes"


@dataclass
class EmbedHit:
    intent: str
    score: float
    nearest_example: str
    max_sim: float
    centroid_sim: float


class PrototypeBank:
    def __init__(self) -> None:
        self._vectors = None      # (n, d)
        self._centroids = None    # (k, d)
        self._labels: list[str] = []          # per example
        self._texts: list[str] = []           # per example
        self._centroid_labels: list[str] = []
        self._ready = False
        self._error: str | None = None

    # ---------------------------------------------------------------- build
    def _fingerprint(self) -> str:
        payload = json.dumps(
            {name: list(spec.examples) for name, spec in sorted(INTENTS.items())},
            ensure_ascii=False,
            sort_keys=True,
        )
        stamp = f"{settings.embedder_model}|{payload}"
        return hashlib.sha256(stamp.encode("utf-8")).hexdigest()[:16]

    def _cache_path(self) -> Path:
        return CACHE_DIR / f"bank-{self._fingerprint()}.npz"

    def ensure(self) -> bool:
        if self._ready:
            return True
        if self._error is not None:
            return False
        try:
            self._build()
            self._ready = True
            return True
        except Exception as exc:  # noqa: BLE001
            self._error = f"{type(exc).__name__}: {exc}"
            log.warning("prototype bank unavailable -> %s", self._error)
            return False

    def _build(self) -> None:
        import numpy as np

        texts: list[str] = []
        labels: list[str] = []
        for name, spec in sorted(INTENTS.items()):
            for example in spec.examples:
                texts.append(example)
                labels.append(name)

        cache = self._cache_path()
        vectors = None
        if cache.exists():
            try:
                blob = np.load(cache, allow_pickle=False)
                if blob["vectors"].shape[0] == len(texts):
                    vectors = blob["vectors"]
                    log.info("prototype bank loaded from cache (%s)", cache.name)
            except Exception:  # noqa: BLE001 - a corrupt cache just gets rebuilt
                vectors = None

        if vectors is None:
            vectors = embeddings.encode(texts, kind="passage")
            if vectors is None:
                raise RuntimeError("embedder model unavailable")
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(cache, vectors=vectors)
            log.info("prototype bank built: %d examples -> %s", len(texts), cache.name)

        centroid_labels = sorted({*labels})
        centroids = np.zeros((len(centroid_labels), vectors.shape[1]), dtype="float32")
        for i, name in enumerate(centroid_labels):
            rows = [j for j, lab in enumerate(labels) if lab == name]
            centroid = vectors[rows].mean(axis=0)
            norm = float(np.linalg.norm(centroid)) or 1.0
            centroids[i] = centroid / norm

        self._vectors, self._labels, self._texts = vectors, labels, texts
        self._centroids, self._centroid_labels = centroids, centroid_labels

    # ---------------------------------------------------------------- query
    def rank(self, text: str, *, allowed: set[str] | None = None, top_k: int = 3) -> list[EmbedHit]:
        if not self.ensure():
            return []
        import numpy as np

        query = embeddings.encode_one(text, kind="query")
        if query is None:
            return []

        sims = self._vectors @ query                      # cosine, both normalised
        centroid_sims = self._centroids @ query

        centroid_lookup = {name: float(centroid_sims[i]) for i, name in enumerate(self._centroid_labels)}
        best: dict[str, tuple[float, str]] = {}
        for idx, label in enumerate(self._labels):
            if allowed is not None and label not in allowed:
                continue
            sim = float(sims[idx])
            if label not in best or sim > best[label][0]:
                best[label] = (sim, self._texts[idx])

        hits = [
            EmbedHit(
                intent=label,
                score=0.65 * max_sim + 0.35 * centroid_lookup.get(label, 0.0),
                nearest_example=example,
                max_sim=max_sim,
                centroid_sim=centroid_lookup.get(label, 0.0),
            )
            for label, (max_sim, example) in best.items()
        ]
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:top_k]

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def error(self) -> str | None:
        return self._error

    def info(self) -> dict:
        return {
            "ready": self._ready,
            "error": self._error,
            "examples": len(self._texts),
            "intents": len(self._centroid_labels),
            "model": settings.embedder_model,
        }


BANK = PrototypeBank()


def rank(text: str, *, allowed: set[str] | None = None, top_k: int = 3) -> list[EmbedHit]:
    return BANK.rank(text, allowed=allowed, top_k=top_k)


def warm() -> bool:
    """Prepare stage L2 fully: prototype bank *and* the encoder itself.

    Building the bank normally loads the encoder as a side effect, but not when
    the bank is restored from its disk cache - and then the encoder would not
    load until the first question actually reached L2, which in a demo is the
    first question the keyword layer does not recognise. Force it here so the
    cost is paid at startup, where it belongs.
    """
    if not BANK.ensure():
        return False
    if embeddings.encode_one("warm up") is None:
        log.warning("prototype bank ready but the encoder failed to load")
        return False
    return True
