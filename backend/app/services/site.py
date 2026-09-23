"""Site conditions.

Weather and ground state are inputs to the task-time estimator and to several
assistant answers, so they live in one place. Values are deterministic for a
given date, which keeps a demo reproducible while still changing day to day.
"""

from __future__ import annotations

import random
from datetime import datetime

from . import telemetry

WEATHER_HI = {
    "clear": "साफ़ मौसम", "hot": "तेज़ गर्मी", "rain": "बारिश",
    "overcast": "बादल छाए हुए", "dust": "धूल भरी हवा",
}
WEATHER_EN = {
    "clear": "Clear", "hot": "Hot", "rain": "Rain", "overcast": "Overcast", "dust": "Dusty",
}
GROUND_HI = {"dry": "सूखी ज़मीन", "wet": "गीली ज़मीन", "rocky": "पथरीली ज़मीन", "soft": "नरम ज़मीन"}
GROUND_EN = {"dry": "Dry", "wet": "Wet", "rocky": "Rocky", "soft": "Soft"}

# Advice attached to the condition, spoken to the operator when it matters.
ADVICE = {
    "rain": ("Reduce speed on the ramp and keep a longer stopping distance.",
             "रैंप पर गति कम रखें और रुकने के लिए ज़्यादा दूरी छोड़ें।"),
    "hot": ("Watch the coolant gauge and take the scheduled cooling breaks.",
            "कूलेंट गेज पर नज़र रखें और तय ब्रेक ज़रूर लें।"),
    "dust": ("Keep the cab air filter on recirculate and use the work lights.",
             "कैब का एयर फ़िल्टर रीसर्कुलेट पर रखें और वर्क लाइट चालू रखें।"),
    "clear": ("", ""),
    "overcast": ("", ""),
}


def _rng(now: datetime) -> random.Random:
    return random.Random(now.strftime("%Y%m%d"))


def conditions(machine_id: str | None = None, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    rng = _rng(now)
    weather = rng.choices(
        ["clear", "hot", "overcast", "dust", "rain"], weights=[0.34, 0.26, 0.18, 0.14, 0.08]
    )[0]
    ground = rng.choices(["dry", "rocky", "soft", "wet"], weights=[0.5, 0.25, 0.15, 0.10])[0]
    if weather == "rain":
        ground = "wet"

    ambient = 33.0
    if machine_id:
        try:
            reading = telemetry.snapshot(machine_id, now)["sensors"].get("ambient_temp_c")
            if reading and isinstance(reading["value"], (int, float)):
                ambient = float(reading["value"])
        except KeyError:
            pass

    shift = "day" if 6 <= now.hour < 18 else "night"
    advice_en, advice_hi = ADVICE.get(weather, ("", ""))
    return {
        "weather": weather,
        "weather_en": WEATHER_EN[weather],
        "weather_hi": WEATHER_HI[weather],
        "ground": ground,
        "ground_en": GROUND_EN[ground],
        "ground_hi": GROUND_HI[ground],
        "ambient_temp_c": round(ambient, 1),
        "shift": shift,
        "advice_en": advice_en,
        "advice_hi": advice_hi,
        "date": now.strftime("%Y-%m-%d"),
    }
