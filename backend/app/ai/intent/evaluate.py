"""Measure how well the router actually classifies.

    python -m app.ai.intent.evaluate
    python -m app.ai.intent.evaluate --stage rules   # rule layer on its own

The test set below is held out from the training examples: none of these
phrasings appear in taxonomy.py, so it measures generalisation across phrasing
rather than memorisation. It is written the way operators really talk -
Devanagari, romanised Hinglish, English, and a block of out-of-scope chatter the
assistant must refuse rather than guess.

Honest caveat: the rule layer's keyword lists were widened in response to the
failures this set exposed, so the current score on it is no longer a blind
measurement - read it as a regression suite, not as an unbiased accuracy figure.
Recordings from real operators are what this needs next, and the file is written
so those can simply be appended to TEST_SET.
"""

from __future__ import annotations

import argparse
from collections import Counter

from . import rules
from .router import route
from .taxonomy import UNKNOWN

# (utterance, expected intent)
TEST_SET: list[tuple[str, str]] = [
    # ---- fuel ----
    ("टंकी में डीजल कितना है", "FUEL_STATUS"),
    ("क्या ईंधन शाम तक चल जाएगा", "FUEL_STATUS"),
    ("diesel khatam to nahi ho raha", "FUEL_STATUS"),
    ("do I have enough fuel for the shift", "FUEL_STATUS"),
    # ---- temperatures ----
    ("इंजन का तापमान ठीक है ना", "ENGINE_TEMP"),
    ("engine kitna heat ho raha hai", "ENGINE_TEMP"),
    ("हाइड्रोलिक ऑयल गरम तो नहीं", "HYDRAULIC_TEMP"),
    ("check the hydraulic oil heat", "HYDRAULIC_TEMP"),
    ("गियरबॉक्स का तापमान बताइए", "TRANSMISSION_TEMP"),
    # ---- other sensors ----
    ("बैटरी का चार्ज कैसा है", "BATTERY_STATUS"),
    ("टायर में हवा कम तो नहीं है", "TIRE_PRESSURE"),
    ("पटरी ढीली लग रही है क्या", "TRACK_TENSION"),
    ("मशीन कुल कितने घंटे चल चुकी है", "ENGINE_HOURS"),
    ("अंडरकैरिज की हालत कैसी है", "UNDERCARRIAGE_WEAR"),
    ("ऑयल का प्रेशर सही है", "OIL_PRESSURE"),
    ("हाइड्रोलिक का दबाव कितना चल रहा है", "HYDRAULIC_PRESSURE"),
    # ---- usage ----
    ("मशीन बेकार में कितनी देर चलती रही", "IDLE_TIME"),
    ("aaj idling kitni hui", "IDLE_TIME"),
    ("आज कुल कितनी बकेट भरी गईं", "LOAD_CYCLES"),
    ("बकेट में अभी कितना माल है", "PAYLOAD_STATUS"),
    ("क्या मैं आज ठीक काम कर रहा हूँ", "PRODUCTIVITY"),
    # ---- diagnostics ----
    ("मशीन में कुछ गड़बड़ तो नहीं है", "MACHINE_HEALTH"),
    ("sab kuch theek chal raha hai kya", "MACHINE_HEALTH"),
    ("anything broken on this machine", "MACHINE_HEALTH"),
    ("कोई अजीब पैटर्न दिखा क्या", "ANOMALY_STATUS"),
    ("डैशबोर्ड पर कोई चेतावनी है", "ACTIVE_ALERTS"),
    ("मशीन की सर्विस कब करवानी है", "MAINTENANCE_DUE"),
    ("kitne ghante baad service hai", "MAINTENANCE_DUE"),
    # ---- safety ----
    ("क्या सब सुरक्षित है अभी", "SAFETY_STATUS"),
    ("मेरी बेल्ट बंधी हुई है ना", "SEATBELT_STATUS"),
    ("seat belt laga hua hai kya", "SEATBELT_STATUS"),
    ("पीछे कोई आदमी तो नहीं है", "PROXIMITY_HAZARD"),
    ("is it safe to swing right now", "PROXIMITY_HAZARD"),
    ("एक हादसा दर्ज करवाना है", "REPORT_INCIDENT"),
    ("mujhe near miss report karna hai", "REPORT_INCIDENT"),
    # ---- tasks ----
    ("बताओ आज मुझे क्या करना है", "TASK_TODAY"),
    ("aaj ki duty kya hai meri", "TASK_TODAY"),
    ("इसके बाद कौन सा काम है", "TASK_NEXT"),
    ("what job comes next", "TASK_NEXT"),
    ("यह खत्म होने में कितनी देर है", "TASK_TIME_ESTIMATE"),
    ("kitni der aur lagegi is kaam me", "TASK_TIME_ESTIMATE"),
    ("when will this be finished", "TASK_TIME_ESTIMATE"),
    ("अभी तक कितना काम निपटा", "TASK_PROGRESS"),
    ("पूरे दिन का ब्योरा दीजिए", "SHIFT_SUMMARY"),
    # ---- training ----
    ("मुझे यह मशीन चलाना सीखना है", "TRAINING_HELP"),
    ("koi training video hai kya", "TRAINING_HELP"),
    ("ट्रक में लोड करने का सही तरीका क्या है", "HOW_TO_OPERATE"),
    # ---- meta ----
    ("आज बाहर कितनी गर्मी है", "WEATHER_CONDITIONS"),
    ("मुझे एक्सकेवेटर पर जाना है", "SWITCH_MACHINE"),
    ("switch to the loader please", "SWITCH_MACHINE"),
    ("डोज़र चुनो", "SWITCH_MACHINE"),
    ("नमस्ते सहायक जी", "GREETING"),
    ("तुम किन चीज़ों में मदद कर सकते हो", "HELP"),
    # ---- must refuse ----
    ("आज शाम को क्या खाना बनेगा", UNKNOWN),
    ("मेरी सैलरी कब आएगी", UNKNOWN),
    ("who won the cricket match", UNKNOWN),
    ("गाड़ी का इंश्योरेंस कब रिन्यू होगा", UNKNOWN),
    ("tell me a joke please", UNKNOWN),
]


def _predict(utterance: str, stage: str) -> str:
    if stage == "classifier":
        from . import classifier
        from .normalize import normalize
        hit = classifier.predict(normalize(utterance))
        if hit is None:
            raise SystemExit("No trained classifier found at backend/models/intent-classifier")
        return hit.intent if hit.score >= 0.5 else UNKNOWN
    if stage == "rules":
        hit = rules.best(utterance)
        return hit.intent if hit and hit.score >= 0.62 else UNKNOWN
    return route(utterance).intent


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate intent routing accuracy")
    parser.add_argument("--stage", default="router", choices=["router", "rules", "classifier"])
    parser.add_argument("--verbose", action="store_true", help="print every case")
    args = parser.parse_args()

    correct = 0
    wrong: list[tuple[str, str, str]] = []
    by_stage: Counter = Counter()

    for utterance, expected in TEST_SET:
        if args.stage == "router":
            result = route(utterance)
            predicted = result.intent
            by_stage[result.stage] += 1
        else:
            predicted = _predict(utterance, "rules")

        ok = predicted == expected
        correct += ok
        if not ok:
            wrong.append((utterance, expected, predicted))
        if args.verbose:
            print(f"{'PASS' if ok else 'FAIL'}  {utterance:44s} {expected:22s} -> {predicted}")

    total = len(TEST_SET)
    in_scope = [(u, e) for u, e in TEST_SET if e != UNKNOWN]
    refusals = [(u, e) for u, e in TEST_SET if e == UNKNOWN]
    refusal_correct = sum(1 for u, _ in refusals if _predict(u, args.stage) == UNKNOWN)

    print(f"\nstage            : {args.stage}")
    print(f"overall accuracy : {correct}/{total} = {correct / total:.1%}")
    print(f"in-scope intents : {len(in_scope)} cases")
    print(f"correctly refused: {refusal_correct}/{len(refusals)} out-of-scope")
    if by_stage:
        print("resolved by      : " + ", ".join(f"{k}={v}" for k, v in by_stage.most_common()))

    if wrong:
        print(f"\n{len(wrong)} misclassified:")
        for utterance, expected, predicted in wrong:
            print(f"  {utterance:46s} expected {expected:22s} got {predicted}")


if __name__ == "__main__":
    main()
