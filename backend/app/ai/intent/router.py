"""The intent router - the piece of intelligence this project actually owns.

Design philosophy from the brief: do not hand every operator question to a large
model. Escalate only as far as the question requires.

    L0  quick action     the UI sent an explicit intent id          ~0 ms
    L1  rules            keyword//token match over the taxonomy     <1 ms
    L2  embeddings       cosine kNN over the prototype bank         ~15 ms
    L3  classifier       fine-tuned MuRIL head (once trained)       ~25 ms
    L4  fallback         clarify, and offer the machine's top asks   ~0 ms

Each stage can accept, or pass the question down with what it learned. The full
trace is returned to the caller, which is what the UI renders as the "how this
was answered" strip - it makes the routing visible instead of magic.

Machine context is applied as a hard filter: an intent that the selected machine
cannot answer is never returned, it is converted into an explicit
"this machine has no such sensor" outcome.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from ...config import settings
from . import classifier, embedder, rules
from .normalize import detect_script, match_machine_family, normalize
from .taxonomy import INTENTS, UNKNOWN


@dataclass
class TraceStep:
    stage: str
    intent: str | None
    score: float
    accepted: bool
    detail: str = ""
    ms: float = 0.0


@dataclass
class RouteResult:
    intent: str
    confidence: float
    stage: str
    text: str
    normalized: str
    script: str
    slots: dict[str, str] = field(default_factory=dict)
    alternatives: list[tuple[str, float]] = field(default_factory=list)
    trace: list[TraceStep] = field(default_factory=list)
    unsupported_on_machine: bool = False
    total_ms: float = 0.0

    def as_dict(self) -> dict:
        return {
            "intent": self.intent,
            "confidence": round(self.confidence, 4),
            "stage": self.stage,
            "text": self.text,
            "normalized": self.normalized,
            "script": self.script,
            "slots": self.slots,
            "alternatives": [{"intent": i, "score": round(s, 4)} for i, s in self.alternatives],
            "unsupported_on_machine": self.unsupported_on_machine,
            "total_ms": round(self.total_ms, 2),
            "trace": [
                {
                    "stage": t.stage,
                    "intent": t.intent,
                    "score": round(t.score, 4),
                    "accepted": t.accepted,
                    "detail": t.detail,
                    "ms": round(t.ms, 2),
                }
                for t in self.trace
            ],
        }


def route(
    text: str,
    *,
    supported_intents: set[str] | None = None,
    forced_intent: str | None = None,
) -> RouteResult:
    """Classify one operator utterance in the context of one machine."""
    started = time.perf_counter()
    norm = normalize(text)
    result = RouteResult(
        intent=UNKNOWN,
        confidence=0.0,
        stage="fallback",
        text=text,
        normalized=norm,
        script=detect_script(text),
    )

    # ---------------------------------------------------------------- L0
    # The UI tapped a quick-question chip: the intent is already known, there is
    # nothing to classify and nothing to pay for.
    if forced_intent:
        result.intent = forced_intent
        result.confidence = 1.0
        result.stage = "quick_action"
        result.trace.append(TraceStep("L0:quick_action", forced_intent, 1.0, True, "intent supplied by UI"))
        _apply_machine_context(result, supported_intents)
        result.total_ms = (time.perf_counter() - started) * 1000
        return result

    if not norm:
        result.trace.append(TraceStep("L0:empty", None, 0.0, False, "empty utterance"))
        result.total_ms = (time.perf_counter() - started) * 1000
        return result

    # SWITCH_MACHINE carries a slot, so capture it regardless of which stage wins.
    family = match_machine_family(norm)

    # ---------------------------------------------------------------- L1
    t0 = time.perf_counter()
    rule_hits = rules.rank(text, allowed=None)
    rule_ms = (time.perf_counter() - t0) * 1000
    top_rule = rule_hits[0] if rule_hits else None

    if top_rule and top_rule.score >= settings.rule_min_score:
        # Guard against a near tie: two intents sharing vocabulary should be
        # settled by meaning, not by keyword length.
        runner_up = rule_hits[1].score if len(rule_hits) > 1 else 0.0
        if top_rule.score - runner_up >= 0.10 or not embedder.BANK.ready:
            result.intent = top_rule.intent
            result.confidence = top_rule.score
            result.stage = "rules"
            result.slots.update(top_rule.slots)
            result.alternatives = [(h.intent, h.score) for h in rule_hits[1:3]]
            result.trace.append(
                TraceStep("L1:rules", top_rule.intent, top_rule.score, True,
                          f"matched {', '.join(top_rule.matched[:3])}", rule_ms)
            )
            _finish(result, family, supported_intents, started)
            return result
        result.trace.append(
            TraceStep("L1:rules", top_rule.intent, top_rule.score, False,
                      f"ambiguous with {rule_hits[1].intent}", rule_ms)
        )
    else:
        detail = "no keyword match" if not top_rule else f"below {settings.rule_min_score:.2f}"
        result.trace.append(
            TraceStep("L1:rules", top_rule.intent if top_rule else None,
                      top_rule.score if top_rule else 0.0, False, detail, rule_ms)
        )

    # ---------------------------------------------------------------- L2
    t0 = time.perf_counter()
    embed_hits = embedder.rank(text, allowed=None, top_k=3)
    embed_ms = (time.perf_counter() - t0) * 1000

    if embed_hits:
        top = embed_hits[0]
        margin = top.score - (embed_hits[1].score if len(embed_hits) > 1 else 0.0)
        if top.score >= settings.embed_accept and margin >= settings.embed_margin:
            result.intent = top.intent
            result.confidence = top.score
            result.stage = "embeddings"
            result.alternatives = [(h.intent, h.score) for h in embed_hits[1:]]
            result.trace.append(
                TraceStep("L2:embeddings", top.intent, top.score, True,
                          f'nearest: "{top.nearest_example}"', embed_ms)
            )
            _finish(result, family, supported_intents, started)
            return result
        result.trace.append(
            TraceStep("L2:embeddings", top.intent, top.score, False,
                      f"margin {margin:.3f} below {settings.embed_margin:.3f}", embed_ms)
        )
    else:
        result.trace.append(
            TraceStep("L2:embeddings", None, 0.0, False,
                      embedder.BANK.error or "embedder not loaded", embed_ms)
        )

    # ---------------------------------------------------------------- L3
    t0 = time.perf_counter()
    clf_hit = classifier.predict(norm, allowed=None) if classifier.available() else None
    clf_ms = (time.perf_counter() - t0) * 1000

    if clf_hit and clf_hit.score >= settings.classifier_accept and clf_hit.intent != UNKNOWN:
        result.intent = clf_hit.intent
        result.confidence = clf_hit.score
        result.stage = "classifier"
        result.alternatives = clf_hit.top_k[1:]
        result.trace.append(
            TraceStep("L3:classifier", clf_hit.intent, clf_hit.score, True,
                      f"margin {clf_hit.margin:.3f}", clf_ms)
        )
        _finish(result, family, supported_intents, started)
        return result
    result.trace.append(
        TraceStep("L3:classifier", clf_hit.intent if clf_hit else None,
                  clf_hit.score if clf_hit else 0.0, False,
                  "not trained yet" if clf_hit is None else "below threshold", clf_ms)
    )

    # ---------------------------------------------------------------- L4
    # Nothing was confident enough. Rather than guess, keep the best guesses as
    # alternatives so the UI can offer "did you mean" chips.
    pool: list[tuple[str, float]] = []
    pool += [(h.intent, h.score) for h in rule_hits[:2]]
    pool += [(h.intent, h.score) for h in embed_hits[:2]]
    if clf_hit:
        pool += clf_hit.top_k[:2]
    seen: set[str] = set()
    ranked: list[tuple[str, float]] = []
    for name, score in sorted(pool, key=lambda x: x[1], reverse=True):
        if name in seen or name == UNKNOWN:
            continue
        seen.add(name)
        ranked.append((name, score))

    result.intent = UNKNOWN
    result.confidence = ranked[0][1] if ranked else 0.0
    result.stage = "fallback"
    result.alternatives = ranked[:3]
    result.trace.append(TraceStep("L4:fallback", UNKNOWN, result.confidence, True, "asking operator to confirm"))
    _finish(result, family, supported_intents, started)
    return result


def _finish(result: RouteResult, family: str | None, supported: set[str] | None, started: float) -> None:
    if family and result.intent == "SWITCH_MACHINE":
        result.slots.setdefault("machine", family)
    _apply_machine_context(result, supported)
    result.total_ms = (time.perf_counter() - started) * 1000


def _apply_machine_context(result: RouteResult, supported: set[str] | None) -> None:
    """A machine cannot answer about a sensor it does not have - say so plainly."""
    if supported is None or result.intent in (UNKNOWN, "SWITCH_MACHINE"):
        return
    if result.intent in supported:
        return
    if result.intent in INTENTS:
        result.unsupported_on_machine = True
        result.trace.append(
            TraceStep("machine_filter", result.intent, result.confidence, False,
                      "intent not supported by the selected machine")
        )


def explain() -> dict:
    """Router configuration, surfaced on /api/system/router for the demo."""
    return {
        "stages": [
            {"id": "L0", "name": "quick_action", "cost": "none", "note": "UI supplied the intent"},
            {"id": "L1", "name": "rules", "cost": "cpu <1ms", "note": "token keyword match"},
            {"id": "L2", "name": "embeddings", "cost": "~15ms", "note": settings.embedder_model},
            {"id": "L3", "name": "classifier", "cost": "~25ms", "note": settings.intent_base_model},
            {"id": "L4", "name": "fallback", "cost": "none", "note": "ask the operator to confirm"},
        ],
        "thresholds": {
            "rule_min_score": settings.rule_min_score,
            "embed_accept": settings.embed_accept,
            "embed_margin": settings.embed_margin,
            "classifier_accept": settings.classifier_accept,
        },
        "embedder": embedder.BANK.info(),
        "classifier": classifier.info(),
    }
