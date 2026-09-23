"""Stage L1 - deterministic keyword matcher.

Answers the large majority of real cab questions in well under a millisecond and
with no model loaded at all. Anything it is not confident about is handed on to
the embedding stage, so precision matters far more here than recall.

Matching is token based rather than substring based: a keyword phrase fires when
every one of its tokens appears somewhere in the utterance, in any order and
with gaps allowed. Hindi puts particles between the words an English speaker
would keep adjacent ("इंजन कितना गरम है" vs "engine temperature"), so a plain
substring test misses far too much.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from functools import lru_cache

from .normalize import match_machine_family, normalize
from .taxonomy import INTENTS, IntentSpec

_QUESTION_MARKERS = {
    "क्या", "कितना", "कितनी", "कितने", "कब", "कहाँ", "कहां", "कौन", "कैसे", "बताओ",
    "बताइए", "सुनाओ", "दिखाओ", "kitna", "kitni", "kitne", "kya", "kab", "kaise",
    "batao", "dikhao", "how", "what", "when", "where", "which", "show", "tell", "is", "are",
}

# Verbs that turn a bare machine name into an actual "switch machine" command.
_SELECT_VERBS = {
    "चुनो", "चुन", "चुनना", "बदलो", "बदल", "बदलना", "चाहिए", "लगाओ", "खोलो", "जाओ",
    "जाना", "जाऊँ", "जाऊं", "पर", "वाली", "दो",
    "select", "choose", "switch", "change", "use", "open", "karo", "chahiye", "badlo",
    "chuno", "jaana", "lagao", "please",
}

_MIN_TOKEN_LEN_FULL_WEIGHT = 4


@lru_cache(maxsize=4096)
def _canon(keyword: str) -> tuple[str, ...]:
    """Keywords must go through the same normaliser as the utterance.

    Otherwise a keyword written "ऑयल प्रेशर" can never match, because the
    normaliser rewrites the incoming "प्रेशर" to "दबाव" before the comparison.
    """
    return tuple(normalize(keyword, drop_fillers=False).split())


@dataclass
class RuleHit:
    intent: str
    score: float
    matched: list[str] = field(default_factory=list)
    slots: dict[str, str] = field(default_factory=dict)


def _token_present(keyword_token: str, utterance_tokens: list[str]) -> bool:
    """Prefix match, so Hindi inflection ("ईंधन" / "ईंधनके") still hits."""
    for tok in utterance_tokens:
        if tok == keyword_token:
            return True
        # Hindi inflects by suffix, so a prefix match covers चली/चलना/चलता.
        if len(keyword_token) >= 3 and tok.startswith(keyword_token):
            return True
        if len(tok) >= 4 and keyword_token.startswith(tok):
            return True
        if len(keyword_token) >= 5 and keyword_token in tok:
            return True
    return False


def _phrase_weight(keyword: str, utterance_tokens: list[str]) -> float:
    """0 if the phrase does not fire, otherwise its specificity."""
    parts = _canon(keyword)
    if not parts:
        return 0.0
    weight = 0.0
    for part in parts:
        if not _token_present(part, utterance_tokens):
            return 0.0
        weight += 1.0 if len(part) >= _MIN_TOKEN_LEN_FULL_WEIGHT else 0.7
    # Multi word phrases are far more specific than single words.
    return weight * (1.0 + 0.5 * (len(parts) - 1))


def _score(spec: IntentSpec, utterance_tokens: list[str]) -> tuple[float, list[str]]:
    matched: list[str] = []
    best_weight = 0.0
    for keyword in spec.keywords:
        weight = _phrase_weight(keyword, utterance_tokens)
        if weight > 0:
            matched.append(keyword)
            best_weight = max(best_weight, weight)
    if not matched:
        return 0.0, []

    score = 0.36 + 0.32 * best_weight
    if len(matched) > 1:
        score += 0.04 * min(3, len(matched) - 1)
    score = min(1.0, score)

    # Clip first, then penalise: otherwise a strong keyword match saturates at
    # 1.0 and the anti-keyword silently has no effect.
    for anti in spec.anti_keywords:
        if _phrase_weight(anti, utterance_tokens) > 0:
            score -= 0.42
    return max(0.0, score), matched


def rank(text: str, *, allowed: set[str] | None = None) -> list[RuleHit]:
    """Every intent whose vocabulary fires, best first."""
    norm = normalize(text)
    if not norm:
        return []
    utterance_tokens = norm.split()
    question_bonus = 0.05 if _QUESTION_MARKERS & set(utterance_tokens) else 0.0

    hits: list[RuleHit] = []
    for name, spec in INTENTS.items():
        if allowed is not None and name not in allowed:
            continue
        score, matched = _score(spec, utterance_tokens)
        if score <= 0:
            continue
        hits.append(RuleHit(intent=name, score=min(1.0, score + question_bonus), matched=matched))

    # A named machine plus a selection verb is an unambiguous switch command,
    # and a bare machine name on its own ("लोडर") is one too.
    family = match_machine_family(norm)
    if family and (allowed is None or "SWITCH_MACHINE" in allowed):
        has_verb = bool(_SELECT_VERBS & set(utterance_tokens))
        telemetry_competition = any(h.score > 0.7 and h.intent != "SWITCH_MACHINE" for h in hits)
        if (has_verb or len(utterance_tokens) <= 3) and not telemetry_competition:
            hits = [h for h in hits if h.intent != "SWITCH_MACHINE"]
            hits.append(RuleHit(intent="SWITCH_MACHINE", score=0.90 if has_verb else 0.78,
                                matched=[family], slots={"machine": family}))

    hits.sort(key=lambda h: h.score, reverse=True)
    return hits


def best(text: str, *, allowed: set[str] | None = None) -> RuleHit | None:
    hits = rank(text, allowed=allowed)
    return hits[0] if hits else None
