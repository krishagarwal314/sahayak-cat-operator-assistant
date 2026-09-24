"""Safety coach: ask the safety-risk model "what if?".

The same GradientBoostingClassifier that predicts a safety alert in the next
hour is asked again with one input changed - a ten minute break, the seatbelt
on, the load eased so the engine cools - and with all of them together. It is
also asked the other way: what happens if the operator carries on like this for
another hour. Every number on the coach screen is a real model prediction.
"""

from __future__ import annotations

from itertools import combinations

from .. import db
from ..ml import safety_risk

ACTIONS = [
    {"key": "rest", "icon": "idle", "change": {"minutes_since_break": 0},
     "hi": "10 मिनट आराम", "en": "10 min break",
     "say_hi": "दस मिनट आराम", "say_en": "a ten minute break"},
    {"key": "belt", "icon": "seatbelt", "change": {"belt_off": 0.0},
     "hi": "सीट बेल्ट लगाएँ", "en": "Seatbelt on",
     "say_hi": "सीट बेल्ट", "say_en": "your seatbelt on"},
    {"key": "cool", "icon": "temp", "change": {"engine_temp_c": 85.0},
     "hi": "भार कम करें", "en": "Ease the load",
     "say_hi": "भार कम करना", "say_en": "easing the load"},
]

# Suresh Yadav's afternoon on the excavator: hot, dusty, long without a break,
# seatbelt off, two alerts already. These are the model's inputs, not its output.
DEMO_FEATURES = {
    "weather": "dust", "machine_family": "excavator", "hours_into_shift": 4.5, "minutes_since_break": 220,
    "ambient_temp_c": 41.0, "idle_min": 22, "load_cycles": 12, "engine_temp_c": 101.0,
    "belt_off": 1.0, "proximity": 1.0, "alerts_today": 2.0,
}


def features(machine_id: str, operator_id: str | None) -> dict:
    from . import signals

    if signals.is_demo(machine_id, operator_id):
        f = dict(DEMO_FEATURES)
        # Each time the cab camera caught the operator dozing counts as an alert.
        f["alerts_today"] += len(db.fatigue_events_for(operator_id, machine_id))
        return f
    from .safety import risk_features

    return risk_features(machine_id, operator_id)[0]


def _pct(f: dict) -> int | None:
    r = safety_risk.predict(f)
    return round(r["probability"] * 100) if r else None


def _join(parts: list[str], lang: str) -> str:
    if len(parts) == 1:
        return parts[0]
    word = " और " if lang == "hi" else " and "
    return ", ".join(parts[:-1]) + word + parts[-1]


def coach(machine_id: str, operator_id: str | None) -> dict | None:
    base_f = features(machine_id, operator_id)
    base = _pct(base_f)
    if base is None:
        return None

    # Carry on like this for another hour: an hour more without a break, and
    # the engine creeping hotter.
    later = {**base_f, "minutes_since_break": base_f["minutes_since_break"] + 60,
             "hours_into_shift": base_f["hours_into_shift"] + 1,
             "engine_temp_c": base_f["engine_temp_c"] + 3}
    forecast = _pct(later)

    combos = {}
    keys = [a["key"] for a in ACTIONS]
    for n in range(0, len(keys) + 1):
        for chosen in combinations(keys, n):
            f = dict(base_f)
            for a in ACTIONS:
                if a["key"] in chosen:
                    f.update(a["change"])
            pct = _pct(f)
            label = "+".join(chosen)
            if not chosen:
                say = {"hi": f"अभी ख़तरा {base} प्रतिशत है। ऐसे ही चलाते रहे तो एक घंटे में {forecast} प्रतिशत हो जाएगा।",
                       "en": f"Risk is {base} percent now. Carry on like this and in an hour it will be {forecast} percent."}
            else:
                names_hi = [a["say_hi"] for a in ACTIONS if a["key"] in chosen]
                names_en = [a["say_en"] for a in ACTIONS if a["key"] in chosen]
                say = {"hi": f"{_join(names_hi, 'hi')} से ख़तरा {base} से घटकर {pct} प्रतिशत हो जाएगा।",
                       "en": f"With {_join(names_en, 'en')}, risk drops from {base} to {pct} percent."}
            combos[label] = {"percent": pct, "say": say}

    return {
        "model": {"name": "Safety-risk model", "arch": "GradientBoostingClassifier · 200 trees, depth 2"},
        "percent": base, "forecast": {"minutes": 60, "percent": forecast},
        "actions": [{k: a[k] for k in ("key", "icon", "hi", "en")} | {"alone": combos[a["key"]]["percent"]}
                    for a in ACTIONS],
        "combos": combos,
        "fatigue_events": len(db.fatigue_events_for(operator_id, machine_id)),
    }
