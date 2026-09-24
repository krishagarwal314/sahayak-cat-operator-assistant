"""Record every sentence the demo can speak, using the real voice models.

Run on a machine that has the voice models (and internet the first time):

    DEMO_TIME=2026-09-24T11:30:00 TTS_CACHE_DIR=voices \\
        python scripts/record_voices.py            # everything the server can say
    ... python scripts/record_voices.py --missing  # plus lines the browser asked
                                                   # for but had no recording

Clips land in TTS_CACHE_DIR as WAV; scripts/compress_voices.sh turns them into
the small MP3s the offline demo ships.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db, main  # noqa: E402
from app.ai import tts  # noqa: E402
from app.config import settings  # noqa: E402
from app.routers import machines as machine_router  # noqa: E402
from app.services import assistant, tasks  # noqa: E402

SCRIPTED_TEXT = {"hi": ["एक्सकेवेटर चुनो"], "en": ["Select the excavator"]}


def say(text: str, lang: str, slow: bool) -> None:
    if text and text.strip():
        tts.synthesize(text, language=lang, slow=slow)


def record_server_lines() -> None:
    main._warm_speech()
    operators = [o for o in db.OPERATORS if o.get("role") != "manager"]
    for op in operators:
        for lang in ("hi", "en"):
            b = tasks.briefing(op["id"])
            text = b.get("text", {}) if isinstance(b, dict) else {}
            say(text.get(lang, "") if isinstance(text, dict) else "", lang, True)
            for machine in db.MACHINES:
                mid = machine["id"]
                intents = sorted(assistant.supported_intents(mid) | {"HELP"})
                for intent in intents:
                    try:
                        r = assistant.ask(operator_id=op["id"], machine_id=mid, intent=intent, language=lang)
                    except Exception as exc:  # noqa: BLE001
                        print("  skip", intent, exc)
                        continue
                    spoken = r["reply"]["speech"].get(lang) or r["reply"]["text"].get(lang, "")
                    say(spoken, lang, True)
                    say(spoken, lang, False)
                for q in SCRIPTED_TEXT[lang]:
                    r = assistant.ask(operator_id=op["id"], machine_id=mid, text=q, language=lang)
                    say(r["reply"]["speech"].get(lang) or r["reply"]["text"].get(lang, ""), lang, False)
                body = machine_router.signals(mid, True, lang, {"id": op["id"]})
                for s in body["signals"]:
                    say(s["say"][lang], lang, True)
                say(("यह आपकी मशीन की रिपोर्ट है। " if lang == "hi" else "This is your machine report. ")
                    + body["headline"][lang], lang, True)
            print(f"  {op['name_en']} / {lang}: done  {tts.cache_stats()}")


def record_missing() -> None:
    path = settings.tts_cache_dir / "missing.txt"
    if not path.exists():
        return
    lines = set(path.read_text(encoding="utf-8").splitlines())
    for line in lines:
        try:
            lang, slow, text = line.split("\t", 2)
        except ValueError:
            continue
        say(text, lang, slow == "1")
    path.unlink()
    print(f"  recorded {len(lines)} missing lines")


if __name__ == "__main__":
    if settings.tts_cache_only or not settings.demo_time:
        sys.exit("set DEMO_TIME and leave TTS_CACHE_ONLY off to record")
    started = time.time()
    if "--missing" in sys.argv:
        record_missing()
    else:
        record_server_lines()
    print(f"done in {time.time() - started:.0f}s: {tts.cache_stats()}")
