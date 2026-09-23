"""Turn the taxonomy into a supervised dataset for the intent classifier.

The taxonomy holds ~260 hand written phrases. A transformer head needs more than
that, and it needs to see the kind of text that actually arrives from STT in a
noisy cab, so every seed phrase is expanded with:

  * politeness and address wrappers      "सहायक, <q> ज़रा बताना"
  * code mixing                          Hindi query with English nouns
  * ASR-style corruption                 dropped matras, split words, fillers
  * truncation                           operators trail off mid sentence

Plus a block of genuine out-of-scope chatter labelled UNKNOWN, which is what
stops the classifier from confidently answering questions it should refuse.

    python -m app.ai.intent.build_dataset --out data/intent_dataset.json
"""

from __future__ import annotations

import argparse
import json
import random
import re
from pathlib import Path

from .taxonomy import INTENTS, UNKNOWN

RNG = random.Random(1337)

_HI_WRAPPERS = [
    "{q}", "{q}", "{q}", "ज़रा {q}", "सहायक {q}", "भाई {q}", "{q} बताओ ज़रा",
    "सुनो {q}", "अच्छा {q}", "{q} please", "एक बात बताओ {q}", "{q} जल्दी बताओ",
]
_EN_WRAPPERS = [
    "{q}", "{q}", "{q}", "hey {q}", "can you tell me {q}", "{q} please",
    "quick question {q}", "listen {q}", "sahayak {q}",
]

# Nouns an operator freely swaps between languages mid sentence.
_CODE_MIX = {
    "ईंधन": "fuel", "डीजल": "diesel", "तापमान": "temperature", "इंजन": "engine",
    "मशीन": "machine", "सुरक्षा": "safety", "काम": "task", "समय": "time",
    "घंटे": "hours", "बैटरी": "battery", "अलर्ट": "alert", "सर्विस": "service",
    "वज़न": "weight", "मौसम": "weather", "ट्रेनिंग": "training",
}

_MATRAS = "ािीुूेैोौंँ"

_OUT_OF_SCOPE = [
    "आज क्रिकेट मैच का स्कोर क्या है", "मेरी तनख्वाह कब आएगी", "कल छुट्टी है क्या",
    "चाय कहाँ मिलेगी", "घर पर फोन लगाना है", "गाना बजाओ", "कोई मज़ेदार बात सुनाओ",
    "दिल्ली का किराया कितना है", "मेरी बीवी को फोन करो", "बाज़ार कितनी दूर है",
    "प्रधानमंत्री कौन है", "दो और दो कितने होते हैं", "मुझे भूख लगी है",
    "कल का मैच कौन जीता", "अगले हफ्ते की छुट्टी चाहिए", "मेरा मोबाइल कहाँ रखा है",
    "cricket score kya hai", "salary kab milegi", "chai peene chalo",
    "what is the capital of India", "play some music", "call my wife",
    "tell me a joke", "how is the stock market", "book a train ticket",
    "मौसी की तबीयत कैसी है", "बस कब आएगी", "पेट्रोल पंप कहाँ है",
]


def _corrupt(text: str) -> str:
    """Cheap stand-in for ASR error: drop a matra, split or join a word."""
    if len(text) < 6:
        return text
    mode = RNG.random()
    if mode < 0.4:
        positions = [i for i, ch in enumerate(text) if ch in _MATRAS]
        if positions:
            i = RNG.choice(positions)
            return text[:i] + text[i + 1 :]
    elif mode < 0.7:
        words = text.split()
        if len(words) > 2:
            i = RNG.randrange(len(words))
            word = words[i]
            if len(word) > 3:
                cut = RNG.randrange(2, len(word) - 1)
                words[i] = word[:cut] + " " + word[cut:]
            return " ".join(words)
    else:
        words = text.split()
        if len(words) > 2:
            i = RNG.randrange(len(words) - 1)
            words[i : i + 2] = ["".join(words[i : i + 2])]
            return " ".join(words)
    return text


def _code_mix(text: str) -> str:
    for hindi, english in _CODE_MIX.items():
        if hindi in text and RNG.random() < 0.6:
            text = text.replace(hindi, english, 1)
            break
    return text


def _truncate(text: str) -> str:
    words = text.split()
    if len(words) <= 3:
        return text
    return " ".join(words[: max(2, len(words) - RNG.randint(1, 2))])


def _is_latin(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return True
    return sum(1 for c in letters if "ऀ" <= c <= "ॿ") / len(letters) < 0.3


def augment(seed: str, n: int) -> list[str]:
    out = {seed}
    wrappers = _EN_WRAPPERS if _is_latin(seed) else _HI_WRAPPERS
    guard = 0
    while len(out) < n and guard < n * 12:
        guard += 1
        variant = RNG.choice(wrappers).format(q=seed)
        roll = RNG.random()
        if roll < 0.30:
            variant = _corrupt(variant)
        elif roll < 0.50:
            variant = _code_mix(variant)
        elif roll < 0.60:
            variant = _truncate(variant)
        variant = re.sub(r"\s+", " ", variant).strip()
        if variant:
            out.add(variant)
    return list(out)


def build(per_example: int = 6, unknown_multiplier: int = 8) -> list[dict]:
    rows: list[dict] = []
    for name, spec in sorted(INTENTS.items()):
        for example in spec.examples:
            for variant in augment(example, per_example):
                rows.append({"text": variant, "label": name})

    for phrase in _OUT_OF_SCOPE:
        for variant in augment(phrase, unknown_multiplier):
            rows.append({"text": variant, "label": UNKNOWN})

    # Deduplicate while preserving the first label seen.
    seen: set[str] = set()
    unique: list[dict] = []
    for row in rows:
        key = row["text"].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    RNG.shuffle(unique)
    return unique


def split(rows: list[dict], val_fraction: float = 0.15) -> tuple[list[dict], list[dict]]:
    """Stratified split so every intent appears in validation."""
    by_label: dict[str, list[dict]] = {}
    for row in rows:
        by_label.setdefault(row["label"], []).append(row)

    train: list[dict] = []
    val: list[dict] = []
    for label, items in by_label.items():
        RNG.shuffle(items)
        cut = max(1, int(len(items) * val_fraction))
        val.extend(items[:cut])
        train.extend(items[cut:])
    RNG.shuffle(train)
    RNG.shuffle(val)
    return train, val


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the intent training dataset")
    parser.add_argument("--out", default="data/intent_dataset.json")
    parser.add_argument("--per-example", type=int, default=6)
    args = parser.parse_args()

    rows = build(per_example=args.per_example)
    train, val = split(rows)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"train": train, "validation": val}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )

    counts: dict[str, int] = {}
    for row in rows:
        counts[row["label"]] = counts.get(row["label"], 0) + 1
    print(f"{len(rows)} rows  ({len(train)} train / {len(val)} val) across {len(counts)} labels")
    print(f"smallest class: {min(counts.values())}   largest: {max(counts.values())}")
    print(f"written to {out}")


if __name__ == "__main__":
    main()
