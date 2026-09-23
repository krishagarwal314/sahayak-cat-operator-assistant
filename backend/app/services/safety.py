"""Safety layer: seatbelt compliance, proximity, incident logging.

Covers the three safety outcomes named in the brief - seatbelt compliance,
proximity hazards and incident logging - and rolls them into a single score the
dashboard can show at a glance.
"""

from __future__ import annotations

from datetime import datetime

from .. import db
from . import telemetry


def seatbelt_compliance(machine_id: str) -> dict:
    """Compliance measured over this machine's recorded readings."""
    rows = db.telemetry_history(machine_id, limit=10_000)
    belts = [r.get("Seatbelt Status", "") for r in rows if r.get("Seatbelt Status")]
    samples = len(belts)
    violations = sum(1 for b in belts if b == "Unfastened")
    rate = (samples - violations) / samples if samples else 1.0

    live = telemetry.snapshot(machine_id)["sensors"].get("seatbelt")
    return {
        "rate_pct": round(rate * 100),
        "samples": samples,
        "violations": violations,
        "currently_fastened": bool(live and live["value"] == "Fastened"),
    }


def proximity_summary(machine_id: str) -> dict:
    rows = db.telemetry_history(machine_id, limit=10_000)
    events = sum(1 for r in rows if r.get("Proximity Event") == "Yes")
    live = telemetry.snapshot(machine_id)["sensors"].get("proximity_objects")
    active = int(live["value"]) if live and isinstance(live["value"], (int, float)) else 0
    return {
        "recorded_events": events,
        "samples": len(rows),
        "active_objects": active,
        "rate_pct": round(events / len(rows) * 100) if rows else 0,
    }


def score(machine_id: str, operator_id: str | None = None) -> int:
    """0-100 safety score for the current state of this machine."""
    belt = seatbelt_compliance(machine_id)
    proximity = proximity_summary(machine_id)
    incidents = db.incidents_for(operator_id, machine_id)

    value = 100
    if not belt["currently_fastened"]:
        value -= 30
    value -= min(20, (100 - belt["rate_pct"]) // 2)
    if proximity["active_objects"]:
        value -= 25
    value -= min(15, proximity["rate_pct"])
    value -= min(20, len(incidents) * 7)
    return max(0, value)


def report(machine_id: str, operator_id: str | None = None) -> dict:
    """Everything the safety panel and the SAFETY_STATUS answer need."""
    belt = seatbelt_compliance(machine_id)
    proximity = proximity_summary(machine_id)
    incidents = db.incidents_for(operator_id, machine_id)
    value = score(machine_id, operator_id)

    issues_hi: list[str] = []
    issues_en: list[str] = []
    severity = "ok"

    if not belt["currently_fastened"]:
        issues_hi.append("सीट बेल्ट नहीं लगी है")
        issues_en.append("seatbelt is unfastened")
        severity = "crit"
    if proximity["active_objects"]:
        issues_hi.append(f"नज़दीकी क्षेत्र में {proximity['active_objects']} वस्तु है")
        issues_en.append(f"{proximity['active_objects']} object in the proximity zone")
        severity = "crit"
    if belt["rate_pct"] < 90 and severity != "crit":
        issues_hi.append(f"बेल्ट अनुपालन {belt['rate_pct']} प्रतिशत है")
        issues_en.append(f"belt compliance is {belt['rate_pct']} percent")
        severity = "warn"

    if issues_hi:
        summary_hi = f"सुरक्षा स्कोर {value} है। ध्यान देने योग्य: " + ", ".join(issues_hi) + "।"
        summary_en = f"Safety score is {value}. Needs attention: " + ", ".join(issues_en) + "."
    else:
        summary_hi = f"सुरक्षा स्कोर {value} है। सब कुछ ठीक है, सीट बेल्ट लगी है और आसपास कोई खतरा नहीं है।"
        summary_en = (f"Safety score is {value}. Everything is fine: the seatbelt is fastened "
                      f"and the proximity zone is clear.")

    return {
        "machine_id": machine_id,
        "score": value,
        "severity": severity,
        "seatbelt": belt,
        "proximity": proximity,
        "incidents": incidents,
        "incident_count": len(incidents),
        "summary_hi": summary_hi,
        "summary_en": summary_en,
        "checked_at": datetime.now().isoformat(timespec="seconds"),
    }


def log_incident(*, operator_id: str, machine_id: str, description: str,
                 category: str = "near_miss", language: str = "hi",
                 severity: str = "medium") -> dict:
    snap = telemetry.snapshot(machine_id)
    return db.add_incident(
        {
            "operator_id": operator_id,
            "machine_id": machine_id,
            "category": category,
            "severity": severity,
            "description": description,
            "language": language,
            "location": (db.machine(machine_id) or {}).get("site", ""),
            "telemetry_at_time": {
                "engine_hours": snap["sensors"].get("engine_hours", {}).get("value"),
                "seatbelt": snap["sensors"].get("seatbelt", {}).get("value"),
                "load_cycles": snap["sensors"].get("load_cycles", {}).get("value"),
                "shift_elapsed_min": snap["shift_elapsed_min"],
            },
        }
    )


# ---------------------------------------------------------------------------
# Extra safety for every machine: predicted risk, working conditions, fatigue
# ---------------------------------------------------------------------------
def extra_warnings(machine_id: str, operator_id: str | None = None) -> list[dict]:
    """Warnings beyond the live sensors, most important first.

    Each one is {key, icon, severity: crit|warn, hi, en} - the same shape the
    machine page already shows and speaks, so they need no new screen.
    """
    from ..ml import safety_risk
    from . import site

    snap = telemetry.snapshot(machine_id)
    sensors = snap["sensors"]
    conditions = site.conditions(machine_id)
    elapsed = snap["shift_elapsed_min"]
    # Breaks are not tracked by a sensor, so assume the scheduled one after
    # four hours; anything longer than three hours since then is fatigue.
    minutes_since_break = elapsed - 270 if elapsed > 270 else elapsed
    out: list[dict] = []

    def num(key: str, default: float = 0.0) -> float:
        value = sensors.get(key, {}).get("value")
        return float(value) if isinstance(value, (int, float)) else default

    features = {
        "weather": conditions["weather"], "machine_family": snap["family"],
        "hours_into_shift": elapsed / 60, "minutes_since_break": minutes_since_break,
        "ambient_temp_c": conditions["ambient_temp_c"], "idle_min": num("idling_time_min") / max(1, elapsed / 60),
        "load_cycles": num("load_cycles") / max(1, elapsed / 60), "engine_temp_c": num("engine_temp_c", 90),
        "belt_off": float(sensors.get("seatbelt", {}).get("value") == "Unfastened"),
        "proximity": float(num("proximity_objects") > 0),
        "alerts_today": float(len(db.incidents_for(operator_id, machine_id))),
    }
    risk = safety_risk.predict(features)
    if risk and risk["level"] != "low":
        pct = round(risk["probability"] * 100)
        # Only name reasons that are not already a live sensor warning.
        reason = next((r for r in risk["reasons"] if r["key"] not in ("belt_off", "proximity")), None)
        out.append({
            "key": "risk", "icon": reason["icon"] if reason else "alert",
            "severity": "crit" if risk["level"] == "high" else "warn",
            "hi": (reason["hi"] if reason else "अगले घंटे में खतरे की संभावना ज़्यादा है। सावधान रहिए।"),
            "en": (reason["en"] if reason else "The chance of a safety problem in the next hour is high. Take care."),
            "probability": risk["probability"], "percent": pct,
        })

    weather = conditions["weather"]
    if conditions["ambient_temp_c"] >= 38 or weather == "hot":
        out.append({"key": "heat", "icon": "sun", "severity": "warn",
                    "hi": "बहुत गर्मी है। हर घंटे पानी पीजिए।", "en": "It is very hot. Drink water every hour."})
    if weather == "rain":
        out.append({"key": "rain", "icon": "slope", "severity": "warn",
                    "hi": "बारिश है। ज़मीन फिसलन भरी है, धीरे चलाइए।", "en": "It is raining. The ground is slippery, go slowly."})
    if weather == "dust":
        out.append({"key": "dust", "icon": "lookaround", "severity": "warn",
                    "hi": "धूल है, कम दिखता है। लाइट जलाइए और हॉर्न बजाइए।",
                    "en": "It is dusty and hard to see. Turn on the lights and sound the horn."})
    if conditions["shift"] == "night":
        out.append({"key": "night", "icon": "lookaround", "severity": "warn",
                    "hi": "रात का समय है। सारी लाइटें जलाइए।", "en": "It is night. Turn on all the lights."})
    if minutes_since_break >= 180 and not any(w["key"] == "risk" and "आराम" in w["hi"] for w in out):
        out.append({"key": "break", "icon": "idle", "severity": "warn",
                    "hi": "तीन घंटे से ज़्यादा काम हो गया। दस मिनट आराम कीजिए।",
                    "en": "You have worked over three hours. Take a ten minute break."})
    return out
