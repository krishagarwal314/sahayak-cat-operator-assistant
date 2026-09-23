"""Build the intent training dataset.

    python -m app.ai.intent.build_dataset

Five FOCUS intents - the ones the demo leans on - get hundreds of varied
English phrasings (plus Hindi and Hinglish), confusable near-misses labelled
with the intent they really belong to, and speech-recognition style noise.
Every other intent keeps its taxonomy phrases with light augmentation, and an
UNKNOWN class of out-of-scope chatter teaches the model to refuse.

Two things keep the validation score honest:

  * phrases are split into train and validation BEFORE variants are made, so
    the model is never validated on a near-copy of a training sentence
  * every row goes through the same normaliser the live router uses, so the
    model trains on exactly the text it will see in production
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import random
import re
from collections import Counter
from pathlib import Path

from .normalize import normalize
from .taxonomy import INTENTS, UNKNOWN

RNG = random.Random(1337)

# ---------------------------------------------------------------------------
# Change this list to change what the model is strongest at.
# ---------------------------------------------------------------------------
FOCUS = ["FUEL_STATUS", "MACHINE_HEALTH", "SAFETY_STATUS", "TASK_TIME_ESTIMATE", "HOW_TO_OPERATE"]

# ---------------------------------------------------------------------------
# English core phrasings for the focus intents
# ---------------------------------------------------------------------------
EN_CORES: dict[str, list[str]] = {
    "FUEL_STATUS": [
        "how much fuel is left", "how much fuel do i have", "how much diesel is left", "how much diesel do we have",
        "what is the fuel level", "what's the fuel level", "check the fuel", "check fuel level", "fuel level please",
        "is the tank almost empty", "am i running low on fuel", "am i low on diesel", "do i need to refuel",
        "should i refuel now", "when do i need to refuel", "how long will the fuel last", "how many hours of fuel left",
        "will the fuel last the shift", "is there enough diesel for today", "how full is the tank", "fuel status",
        "diesel status", "what does the fuel gauge say", "fuel remaining", "how much fuel in the tank", "is the fuel ok",
        "tank level", "do i have enough fuel to finish", "how many litres of diesel are left", "is my fuel running out",
        "how much gas is left", "what's my fuel", "read the fuel gauge", "fuel check", "when will i run out of fuel",
        "is the diesel tank full", "how much diesel remains", "is fuel low",
    ],
    "MACHINE_HEALTH": [
        "is anything wrong with the machine", "is the machine ok", "is the machine healthy", "any problems with the machine",
        "check the machine", "run a health check", "machine health", "how is the machine doing", "is everything working",
        "is anything broken", "are there any faults", "any issues i should know about", "is the machine in good condition",
        "diagnose the machine", "what is wrong with the machine", "how is my machine", "machine status",
        "give me a status report on the machine", "does the machine need attention", "any problem today",
        "is everything fine with the machine", "any faults today", "check for problems", "is the machine working properly",
        "is something wrong", "anything i should worry about with the machine", "health report", "full machine check",
        "is the machine running fine", "any mechanical problems", "is there any damage", "how healthy is the excavator",
        "is the loader ok", "any trouble with the dozer", "what needs fixing", "anything need repair",
    ],
    "SAFETY_STATUS": [
        "is it safe to work", "am i safe", "safety status", "what is my safety status", "is everything safe", "safety check",
        "any safety issues", "any safety warnings", "is the area safe", "is it safe to operate", "safety report",
        "what is my safety score", "any safety violations today", "am i working safely", "is it safe to start",
        "tell me the safety situation", "check safety", "are there any dangers", "is the site safe right now",
        "any safety concerns", "is it safe to continue", "how safe am i", "safety first what should i know",
        "is there any danger", "any risks right now", "is my work area safe", "safety update", "give me a safety check",
        "am i following safety rules", "is everything safe around the machine", "is it dangerous to work now",
        "what are the safety warnings",
    ],
    "TASK_TIME_ESTIMATE": [
        "how long will this task take", "how long will this take", "how much time is left", "when will i finish",
        "when will this job be done", "what time will i be done", "how many hours will this take", "how long until i'm done",
        "estimated time to finish", "eta for this task", "time remaining on this job", "how long for this trench",
        "how much longer", "when can i finish this work", "how long does this job need", "will i finish before lunch",
        "can i finish this by evening", "how many minutes left on this task", "predict how long this will take",
        "finish time", "how long to complete this", "when will the work be complete", "how much time will it take",
        "how long is this job going to take", "time to finish", "when do i finish this task", "how long till completion",
        "how many more hours", "estimate the time for this job", "will this be done today", "how long for the loading",
        "how soon can i finish",
    ],
    "HOW_TO_OPERATE": [
        "how do i start the machine", "how do i dig a trench", "how do i load a truck", "how do i shut down the machine",
        "show me how to operate this", "teach me to use this machine", "how do i use the bucket",
        "how do i push with the blade", "what are the steps to start", "guide me through starting", "how should i dig",
        "what is the right way to load a truck", "how to operate an excavator", "steps to shut down",
        "how do i park safely", "how do i check the oil", "how do i do the pre start check", "how do i lower the bucket",
        "walk me through it", "how does this machine work", "show me the steps", "how do i turn it on",
        "how do i switch off the engine", "how to use this machine", "teach me to dig", "how do i operate the loader",
        "how do i drive the dozer", "what's the procedure to start", "how do i climb in safely", "instructions for this machine",
        "show me the guide", "how to load the truck properly",
    ],
}

PREFIXES = ["", "", "", "hey saathi ", "saathi ", "ok ", "tell me ", "can you tell me ", "quick question ",
            "please ", "hey ", "uh ", "so "]
SUFFIXES = ["", "", "", " please", " right now", " on this machine", " saathi", " now", " today"]

# ---------------------------------------------------------------------------
# Extra Hindi / Hinglish for the focus intents (on top of taxonomy examples)
# ---------------------------------------------------------------------------
HI_EXTRA: dict[str, list[str]] = {
    "FUEL_STATUS": ["टंकी कितनी भरी है", "डीजल कब भरवाना है", "fuel khatam hone wala hai kya", "tank me kitna diesel hai",
                    "kitne ghante ka diesel bacha hai", "ईंधन कम तो नहीं है", "डीजल शाम तक चलेगा क्या", "fuel check karo"],
    "MACHINE_HEALTH": ["machine theek hai kya", "machine me kuch kharab hai kya", "मशीन में कोई दिक्कत है क्या",
                       "मशीन की जाँच करो", "koi fault hai kya", "मशीन सही चल रही है ना", "kuch tuta to nahi"],
    "SAFETY_STATUS": ["kya kaam karna safe hai", "सुरक्षा ठीक है क्या", "कोई खतरा तो नहीं", "safety check karo",
                      "क्या मैं सुरक्षित हूँ", "koi danger to nahi hai", "सुरक्षा की जाँच करो"],
    "TASK_TIME_ESTIMATE": ["kitna time aur lagega", "काम कब खत्म होगा", "कितनी देर और लगेगी", "shaam tak ho jayega kya",
                           "kitne ghante lagenge", "यह काम कितने बजे तक होगा", "lunch se pehle ho jayega kya"],
    "HOW_TO_OPERATE": ["machine kaise chalu karu", "मशीन कैसे चलाते हैं", "trench kaise khode", "ट्रक कैसे भरें",
                       "मशीन कैसे बंद करें", "sikhao kaise chalana hai", "बकेट कैसे चलाएँ", "steps batao"],
}

# ---------------------------------------------------------------------------
# Near misses: sound like a focus intent, belong somewhere else. These are
# what stop the model from shouting FUEL_STATUS at anything mentioning fuel.
# ---------------------------------------------------------------------------
HARD_NEGATIVES: dict[str, list[str]] = {
    "IDLE_TIME": ["how much fuel did i waste idling", "how long did the machine idle", "idle time today",
                  "how many minutes was the engine idle", "am i idling too much"],
    "ENGINE_HOURS": ["how long has the engine been running", "total engine hours", "how many hours on the machine",
                     "what does the hour meter say", "engine hour reading"],
    "MAINTENANCE_DUE": ["how long until the next service", "when is the service due", "is maintenance due",
                        "how many hours to next service"],
    "SEATBELT_STATUS": ["is my seatbelt on", "is my seat belt fastened", "seatbelt check", "did i buckle up"],
    "PROXIMITY_HAZARD": ["is anyone behind me", "is someone near the machine", "can i swing safely",
                         "is anybody around the bucket", "anyone in the blind spot"],
    "ENGINE_TEMP": ["what is the engine temperature", "is the engine overheating", "engine temp"],
    "HYDRAULIC_TEMP": ["what is the hydraulic oil temperature", "is the hydraulic oil hot"],
    "TASK_TODAY": ["what is my task today", "what work do i have today", "read my tasks", "what's my job today"],
    "TASK_NEXT": ["what's next", "what is my next task", "what do i do after this"],
    "TASK_PROGRESS": ["how much of the task is done", "how far along am i", "show my progress"],
    "TRAINING_HELP": ["i need training", "book a trainer", "show me training videos", "i want to learn more"],
    "ACTIVE_ALERTS": ["any alerts", "why is the warning light on", "read the fault codes", "what alerts are active"],
    "ANOMALY_STATUS": ["anything unusual", "any strange patterns", "any abnormal behaviour"],
    "LOAD_CYCLES": ["how many buckets today", "how many cycles have i done", "load count"],
    "REPORT_INCIDENT": ["i want to report an accident", "log a near miss", "report an incident"],
    "PRODUCTIVITY": ["how am i doing today", "am i on target", "how is my productivity"],
}

# Out of scope. Note the traps: "how do i make tea", "how long is the movie" -
# they share words with focus intents but must be refused.
OUT_OF_SCOPE = [
    # everyday chatter
    "what's the cricket score", "tell me a joke", "who is the prime minister", "book a cab", "order lunch",
    "play some music", "set an alarm", "i love you", "good night", "call my wife", "when is my salary coming",
    "what is two plus two", "send a message to my brother", "who won the match", "what is your name",
    "tell me a story", "i am hungry", "where is the toilet", "what time is lunch", "how much money do i earn",
    "book a train ticket", "recharge my phone", "what's the date today", "sing a song",
    # traps: they share words with the focus intents but are not about the machine
    "how do i make tea", "how do i make coffee", "how do i cook rice", "how do i cook dal", "how do i fix my bike",
    "how do i fix my phone", "how do i send money", "how do i book a ticket", "how do i get to the market",
    "how long is the movie", "how long is the flight", "how long is the train journey", "how long does the bus take",
    "how long will the rain last", "how long until the match starts",
    "is it safe to eat street food", "is my phone safe", "is my wallet safe", "is it safe to swim",
    "is my bike safe here", "is this water safe to drink", "is my money safe in the bank",
    "what's the price of petrol in delhi", "how much petrol for my bike", "is anything wrong with my phone",
    "my phone is broken", "is my tv working",
    # Hindi and Hinglish
    "आज क्रिकेट मैच का स्कोर क्या है", "मेरी तनख्वाह कब आएगी", "चाय कहाँ मिलेगी", "गाना बजाओ", "कोई मज़ेदार बात सुनाओ",
    "मुझे भूख लगी है", "बस कब आएगी", "चाय कैसे बनाते हैं", "फिल्म कितनी लंबी है", "फोन सुरक्षित है क्या",
    "salary kab milegi", "chai peene chalo", "movie kitni lambi hai", "chai kaise banaye", "phone kharab hai kya",
]

_FILLERS_EN = ["uh", "um", "like", "so", "okay"]
_ASR_SWAPS = {"fuel": ["fool", "full"], "diesel": ["diesal", "deasel"], "machine": ["mashine", "machin"],
              "excavator": ["excavater"], "safety": ["safty"], "trench": ["french"], "estimate": ["estimated"]}
_MACHINE_WORDS = ["machine", "excavator", "loader", "dozer"]


def _en_noise(text: str) -> str:
    """Speech-recognition style noise on an English utterance."""
    words = text.split()
    roll = RNG.random()
    if roll < 0.15 and len(words) > 3:                         # a filler word dropped in
        words.insert(RNG.randrange(1, len(words)), RNG.choice(_FILLERS_EN))
    elif roll < 0.28:                                          # a misheard word
        for i, w in enumerate(words):
            if w in _ASR_SWAPS and RNG.random() < 0.7:
                words[i] = RNG.choice(_ASR_SWAPS[w])
                break
    elif roll < 0.38 and len(words) > 4:                       # a word lost
        del words[RNG.randrange(1, len(words))]
    elif roll < 0.50:                                          # machine name swapped
        for i, w in enumerate(words):
            if w in _MACHINE_WORDS:
                words[i] = RNG.choice(_MACHINE_WORDS)
                break
    text = " ".join(words)
    text = text.replace("what's", "what is") if RNG.random() < 0.3 else text
    return text


def _en_variants(core: str, n: int) -> set[str]:
    out = {core}
    combos = list(itertools.product(PREFIXES, SUFFIXES))
    RNG.shuffle(combos)
    for prefix, suffix in combos:
        if len(out) >= n:
            break
        out.add(_en_noise(f"{prefix}{core}{suffix}".strip()))
    return out


# --- light augmentation for Hindi / Hinglish, kept from the original builder ---
_MATRAS = "ािीुूेैोौंँ"
_HI_WRAPPERS = ["{q}", "{q}", "ज़रा {q}", "सहायक {q}", "भाई {q}", "{q} बताओ ज़रा", "सुनो {q}", "{q} please"]


def _hi_variants(seed: str, n: int) -> set[str]:
    out = {seed}
    guard = 0
    while len(out) < n and guard < n * 10:
        guard += 1
        v = RNG.choice(_HI_WRAPPERS).format(q=seed)
        if RNG.random() < 0.3:
            positions = [i for i, ch in enumerate(v) if ch in _MATRAS]
            if positions:
                i = RNG.choice(positions)
                v = v[:i] + v[i + 1:]
        out.add(re.sub(r"\s+", " ", v).strip())
    return out


def _is_latin(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return not letters or sum("ऀ" <= c <= "ॿ" for c in letters) / len(letters) < 0.3


def _split_seeds(seeds: list[str], val_fraction: float) -> tuple[list[str], list[str]]:
    seeds = list(dict.fromkeys(seeds))
    RNG.shuffle(seeds)
    cut = max(1, round(len(seeds) * val_fraction)) if len(seeds) >= 4 else 0
    return seeds[cut:], seeds[:cut]


def build(focus_variants: int = 12, other_variants: int = 8, val_fraction: float = 0.2):
    train: list[dict] = []
    val: list[dict] = []

    def emit(rows: list[dict], label: str, texts: set[str], focus: bool):
        for t in texts:
            norm = normalize(t)
            if norm:
                rows.append({"text": norm, "label": label, "focus": focus})

    for name, spec in sorted(INTENTS.items()):
        is_focus = name in FOCUS
        en_seeds = list(EN_CORES.get(name, [])) + [e for e in spec.examples if _is_latin(e)] + HARD_NEGATIVES.get(name, [])
        hi_seeds = [e for e in spec.examples if not _is_latin(e)] + HI_EXTRA.get(name, [])

        en_train, en_val = _split_seeds(en_seeds, val_fraction)
        hi_train, hi_val = _split_seeds(hi_seeds, val_fraction)
        n_en = focus_variants if is_focus else other_variants
        n_hi = max(3, n_en // 2)

        for seed in en_train:
            emit(train, name, _en_variants(seed, n_en), is_focus)
        for seed in en_val:
            emit(val, name, _en_variants(seed, max(2, n_en // 3)), is_focus)
        for seed in hi_train:
            emit(train, name, _hi_variants(seed, n_hi), is_focus)
        for seed in hi_val:
            emit(val, name, _hi_variants(seed, 2), is_focus)

    oos_train, oos_val = _split_seeds(OUT_OF_SCOPE, val_fraction)
    for seed in oos_train:
        emit(train, UNKNOWN, _en_variants(seed, 8) if _is_latin(seed) else _hi_variants(seed, 5), False)
    for seed in oos_val:
        emit(val, UNKNOWN, {seed}, False)

    def dedupe(rows):
        seen, out = set(), []
        for r in rows:
            if r["text"] not in seen:
                seen.add(r["text"]); out.append(r)
        return out

    train = dedupe(train)
    train_texts = {r["text"] for r in train}
    val = [r for r in dedupe(val) if r["text"] not in train_texts]   # no leakage, ever
    RNG.shuffle(train); RNG.shuffle(val)
    return train, val


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the intent training dataset")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[3] / "data" / "intent_dataset.json"))
    args = parser.parse_args()

    train, val = build()
    payload = {"train": train, "validation": val, "meta": {"focus": FOCUS, "normalized": True}}
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    payload["meta"]["fingerprint"] = hashlib.sha256(blob.encode()).hexdigest()[:12]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    counts = Counter(r["label"] for r in train)
    print(f"train {len(train)} rows / validation {len(val)} rows / {len(counts)} labels")
    print("focus intents (train rows):")
    for f in FOCUS:
        print(f"  {f:20s} {counts[f]}")
    others = [c for k, c in counts.items() if k not in FOCUS]
    print(f"other intents: {min(others)}-{max(others)} rows each | UNKNOWN {counts[UNKNOWN]}")
    english = sum(_is_latin(r["text"]) for r in train) / len(train)
    print(f"english share: {english:.0%} | fingerprint {payload['meta']['fingerprint']}")
    print(f"written to {out}")


if __name__ == "__main__":
    main()
