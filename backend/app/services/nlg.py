"""Response generation.

Deliberately template based rather than generative. Three reasons, all of which
matter more in a cab than fluency does:

  * a template cannot hallucinate a fuel level
  * the Hindi is grammatical every single time, which a small translation model
    cannot promise when it is fed generated English
  * it answers in milliseconds and costs nothing

Every reply is produced in both Hindi and English (the UI language switch picks
one), plus a separate `speech` string per language: the TTS models read "%" and
"°C" badly, so the spoken form spells those out.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .. import db
from ..ai.intent.taxonomy import INTENTS
from . import anomaly, estimator, safety, site, telemetry

# --------------------------------------------------------------------------
# speech friendly units
# --------------------------------------------------------------------------
UNIT_SPEECH_HI = {
    "%": "प्रतिशत", "°C": "डिग्री सेल्सियस", "bar": "बार", "kPa": "किलो पास्कल",
    "V": "वोल्ट", "h": "घंटे", "min": "मिनट", "kg": "किलोग्राम", "psi": "पी एस आई",
    "cycles": "साइकिल", "L": "लीटर", "": "",
}
UNIT_SPEECH_EN = {
    "%": "percent", "°C": "degrees celsius", "bar": "bar", "kPa": "kilopascal",
    "V": "volts", "h": "hours", "min": "minutes", "kg": "kilograms", "psi": "psi",
    "cycles": "cycles", "L": "litres", "": "",
}

STATUS_HI = {
    "ok": "यह सामान्य सीमा में है।",
    "warn": "यह सामान्य से बाहर है, कृपया ध्यान दें।",
    "crit": "यह खतरनाक स्तर पर है, तुरंत काम रोकें।",
    "unknown": "इसका डेटा अभी उपलब्ध नहीं है।",
}
STATUS_EN = {
    "ok": "That is within the normal range.",
    "warn": "That is outside the normal range, please keep an eye on it.",
    "crit": "That is at a critical level. Stop work now.",
    "unknown": "No data is available for that right now.",
}
SEVERITY_FROM_STATUS = {"ok": "ok", "warn": "warn", "crit": "crit", "unknown": "ok"}


@dataclass
class Reply:
    text_hi: str
    text_en: str
    speech_hi: str = ""
    speech_en: str = ""
    severity: str = "ok"
    card: dict | None = None
    data: dict = field(default_factory=dict)
    followups: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "text": {"hi": self.text_hi, "en": self.text_en},
            "speech": {"hi": self.speech_hi or self.text_hi, "en": self.speech_en or self.text_en},
            "severity": self.severity,
            "card": self.card,
            "data": self.data,
            "followups": self.followups,
        }


def _num(value) -> str:
    """Drop a pointless trailing .0 so speech does not say 'ninety four point zero'."""
    if isinstance(value, float) and abs(value - round(value)) < 0.05:
        return str(int(round(value)))
    return str(value)


def _duration(total_minutes: float) -> tuple[str, str]:
    """Minutes -> ('2 घंटे 20 मिनट', '2 hours 20 minutes'), dropping empty parts."""
    total = max(0, int(round(total_minutes)))
    hours, minutes = divmod(total, 60)
    if hours and minutes:
        return f"{hours} घंटे {minutes} मिनट", f"{hours} hours {minutes} minutes"
    if hours:
        return f"{hours} घंटे", f"{hours} hours"
    return f"{minutes} मिनट", f"{minutes} minutes"


def _followup(intent: str, label_hi: str, label_en: str) -> dict:
    return {"intent": intent, "label_hi": label_hi, "label_en": label_en}


# --------------------------------------------------------------------------
# generic sensor answer - covers most telemetry intents
# --------------------------------------------------------------------------
def _sensor_reply(machine_id: str, sensor_keys: tuple[str, ...]) -> Reply | None:
    snap = telemetry.snapshot(machine_id)
    reading = None
    for key in sensor_keys:
        candidate = snap["sensors"].get(key)
        if candidate and candidate["status"] != "unknown":
            reading = candidate
            break
    if reading is None:
        return None

    value, unit = reading["value"], reading["unit"]
    unit_hi = UNIT_SPEECH_HI.get(unit, unit)
    unit_en = UNIT_SPEECH_EN.get(unit, unit)
    status = reading["status"]

    text_hi = f"{reading['label_hi']} {_num(value)} {unit_hi} है। {STATUS_HI[status]}".replace("  ", " ")
    text_en = f"{reading['label_en']} is {_num(value)} {unit_en}. {STATUS_EN[status]}".replace("  ", " ")

    return Reply(
        text_hi=text_hi,
        text_en=text_en,
        severity=SEVERITY_FROM_STATUS.get(status, "ok"),
        card={"type": "gauge", "reading": reading, "series": telemetry.recent_series(machine_id, reading["key"])},
        data={"sensor": reading},
    )


# --------------------------------------------------------------------------
# intent specific answers
# --------------------------------------------------------------------------
def _fuel(ctx: dict) -> Reply:
    machine_id = ctx["machine_id"]
    fuel = telemetry.fuel_estimate(machine_id)
    duration_hi, duration_en = _duration(fuel["hours_left"] * 60)

    text_hi = (f"ईंधन {_num(fuel['percent'])} प्रतिशत है, यानी लगभग {_num(fuel['litres'])} लीटर। "
               f"मौजूदा खपत पर यह करीब {duration_hi} और चलेगा।")
    text_en = (f"Fuel is at {_num(fuel['percent'])} percent, about {_num(fuel['litres'])} litres. "
               f"At the current burn rate that lasts roughly {duration_en}.")

    if not fuel["covers_shift"]:
        text_hi += " यह पूरी शिफ्ट के लिए पर्याप्त नहीं है, ब्रेक पर ईंधन भरवा लें।"
        text_en += " That will not cover the rest of the shift, so refuel at the next break."
    elif fuel["status"] != "ok":
        text_hi += " स्तर कम है, ध्यान रखें।"
        text_en += " The level is low, keep an eye on it."

    return Reply(
        text_hi=text_hi, text_en=text_en,
        severity=SEVERITY_FROM_STATUS.get(fuel["status"], "ok"),
        card={"type": "fuel", "fuel": fuel, "series": telemetry.recent_series(machine_id, "fuel_level_pct")},
        data=fuel,
        followups=[_followup("SHIFT_SUMMARY", "आज का हिसाब", "Shift summary"),
                   _followup("IDLE_TIME", "आइडल समय", "Idle time")],
    )


def _machine_health(ctx: dict) -> Reply:
    machine_id = ctx["machine_id"]
    health = anomaly.health_score(machine_id)
    findings = health["findings"]
    counts = health["counts"]

    if not findings:
        return Reply(
            text_hi="मशीन में कोई समस्या नहीं मिली। सभी सेंसर सामान्य सीमा में हैं।",
            text_en="No problems found. Every sensor is within its normal range.",
            severity="ok",
            card={"type": "health", "health": health},
            data=health,
        )

    critical, warning = counts["critical"], counts["warning"]
    top = findings[0]
    if critical:
        head_hi = f"ध्यान दें, {critical} गंभीर समस्या मिली है। "
        head_en = f"Attention: {critical} critical issue(s) found. "
        severity = "crit"
    elif warning:
        head_hi = f"{warning} चेतावनी मिली है। "
        head_en = f"{warning} warning(s) found. "
        severity = "warn"
    else:
        head_hi = "कुछ छोटी बातें ध्यान देने लायक हैं। "
        head_en = "A few minor points worth noting. "
        severity = "ok"

    text_hi = head_hi + f"सबसे ज़रूरी: {top['detail']['hi']} {top['recommendation']['hi']}"
    text_en = head_en + f"Most important: {top['detail']['en']} {top['recommendation']['en']}"

    return Reply(
        text_hi=text_hi, text_en=text_en, severity=severity,
        card={"type": "health", "health": health},
        data=health,
        followups=[_followup("ACTIVE_ALERTS", "सभी अलर्ट", "All alerts"),
                   _followup("MAINTENANCE_DUE", "सर्विस कब", "Service due")],
    )


def _anomalies(ctx: dict) -> Reply:
    findings = anomaly.analyse(ctx["machine_id"])
    if not findings:
        return Reply(
            text_hi="मशीन के इस्तेमाल में कोई असामान्य पैटर्न नहीं मिला।",
            text_en="No unusual usage pattern detected.",
            severity="ok", card={"type": "anomalies", "findings": []},
        )
    lines_hi = " ".join(f"{i}. {f['detail']['hi']}" for i, f in enumerate(findings[:2], 1))
    lines_en = " ".join(f"{i}. {f['detail']['en']}" for i, f in enumerate(findings[:2], 1))
    severity = "crit" if any(f["severity"] == "critical" for f in findings) else "warn"
    return Reply(
        text_hi=f"{len(findings)} असामान्य बातें मिलीं। {lines_hi}",
        text_en=f"{len(findings)} unusual pattern(s) found. {lines_en}",
        severity=severity,
        card={"type": "anomalies", "findings": findings},
        data={"findings": findings},
    )


def _alerts(ctx: dict) -> Reply:
    snap = telemetry.snapshot(ctx["machine_id"])
    attention = snap["attention"]
    if not attention:
        return Reply(
            text_hi="अभी कोई अलर्ट सक्रिय नहीं है। सब ठीक है।",
            text_en="No alerts are active right now. Everything is fine.",
            severity="ok", card={"type": "alerts", "alerts": []},
        )
    names_hi = ", ".join(a["label_hi"] for a in attention)
    names_en = ", ".join(a["label_en"] for a in attention)
    severity = "crit" if any(a["status"] == "crit" for a in attention) else "warn"
    return Reply(
        text_hi=f"{len(attention)} अलर्ट सक्रिय हैं: {names_hi}।",
        text_en=f"{len(attention)} alert(s) active: {names_en}.",
        severity=severity,
        card={"type": "alerts", "alerts": attention},
        data={"alerts": attention},
    )


def _maintenance(ctx: dict) -> Reply:
    status = telemetry.maintenance_status(ctx["machine_id"])
    if status["overdue"]:
        over = abs(status["hours_remaining"])
        return Reply(
            text_hi=f"सर्विस {_num(over)} घंटे पहले ही होनी चाहिए थी। वर्कशॉप को सूचित करें।",
            text_en=f"Service is {_num(over)} hours overdue. Report it to the workshop.",
            severity="crit", card={"type": "maintenance", "maintenance": status}, data=status,
        )
    remaining = status["hours_remaining"]
    return Reply(
        text_hi=(f"अगली सर्विस में {_num(remaining)} इंजन घंटे बाकी हैं। "
                 f"मशीन अभी {_num(status['engine_hours'])} घंटे पर है।"),
        text_en=(f"{_num(remaining)} engine hours remain before the next service. "
                 f"The machine is at {_num(status['engine_hours'])} hours."),
        severity="warn" if status["due_soon"] else "ok",
        card={"type": "maintenance", "maintenance": status}, data=status,
    )


def _safety_status(ctx: dict) -> Reply:
    report = safety.report(ctx["machine_id"], ctx.get("operator_id"))
    return Reply(
        text_hi=report["summary_hi"], text_en=report["summary_en"],
        severity=report["severity"],
        card={"type": "safety", "safety": report}, data=report,
        followups=[_followup("SEATBELT_STATUS", "सीट बेल्ट", "Seatbelt"),
                   _followup("REPORT_INCIDENT", "घटना दर्ज करें", "Report incident")],
    )


def _seatbelt(ctx: dict) -> Reply:
    snap = telemetry.snapshot(ctx["machine_id"])
    reading = snap["sensors"].get("seatbelt")
    fastened = reading and reading["value"] == "Fastened"
    compliance = safety.seatbelt_compliance(ctx["machine_id"])
    if fastened:
        return Reply(
            text_hi=f"सीट बेल्ट लगी हुई है, बहुत अच्छा। आज आपकी बेल्ट अनुपालन दर {compliance['rate_pct']} प्रतिशत है।",
            text_en=f"Your seatbelt is fastened, well done. Your belt compliance today is {compliance['rate_pct']} percent.",
            severity="ok", card={"type": "safety_item", "reading": reading, "compliance": compliance},
            data=compliance,
        )
    return Reply(
        text_hi="सीट बेल्ट नहीं लगी है। कृपया अभी बेल्ट लगाएँ, तभी मशीन चलाएँ।",
        text_en="Your seatbelt is not fastened. Please fasten it before operating the machine.",
        severity="crit", card={"type": "safety_item", "reading": reading, "compliance": compliance},
        data=compliance,
    )


def _proximity(ctx: dict) -> Reply:
    snap = telemetry.snapshot(ctx["machine_id"])
    reading = snap["sensors"].get("proximity_objects")
    count = int(reading["value"]) if reading and isinstance(reading["value"], (int, float)) else 0
    if count:
        return Reply(
            text_hi=f"सावधान! मशीन के पास {count} वस्तु है। सभी हरकत रोकें, हॉर्न बजाएँ और क्षेत्र खाली होने पर ही आगे बढ़ें।",
            text_en=f"Careful! {count} object is inside the proximity zone. Stop moving, sound the horn, and continue only when the area is clear.",
            severity="crit", card={"type": "proximity", "objects": count},
        )
    return Reply(
        text_hi="मशीन के आसपास कोई नहीं है। आप सुरक्षित रूप से काम जारी रख सकते हैं।",
        text_en="Nobody is inside the proximity zone. You can continue safely.",
        severity="ok", card={"type": "proximity", "objects": 0},
    )


def _report_incident(ctx: dict) -> Reply:
    return Reply(
        text_hi="ठीक है, घटना दर्ज करने के लिए तैयार हूँ। कृपया बताइए क्या हुआ, मैं उसे रिकॉर्ड कर दूँगा।",
        text_en="Ready to log an incident. Tell me what happened and I will record it.",
        severity="warn",
        card={"type": "incident_form", "machine_id": ctx["machine_id"]},
    )


def _task_today(ctx: dict) -> Reply:
    operator_id, machine_id = ctx["operator_id"], ctx["machine_id"]
    tasks = db.tasks_for_operator(operator_id)
    if not tasks:
        return Reply(text_hi="आज आपके लिए कोई काम निर्धारित नहीं है।",
                     text_en="No tasks are assigned to you today.", card={"type": "tasks", "tasks": []})

    current = db.active_task(operator_id, machine_id) or tasks[0]
    hi = ctx["task_hi"].get(current["id"], {})
    pending = [t for t in tasks if t["status"] != "done"]

    title_hi = hi.get("title") or current["title_en"]
    text_hi = (f"आज आपके लिए {len(tasks)} काम हैं, {len(pending)} अभी बाकी हैं। "
               f"मौजूदा काम है: {title_hi}। जगह: {current['location']}।")
    text_en = (f"You have {len(tasks)} tasks today and {len(pending)} still pending. "
               f"Current task: {current['title_en']}. Location: {current['location']}.")

    return Reply(
        text_hi=text_hi, text_en=text_en,
        card={"type": "tasks", "tasks": tasks, "current_id": current["id"]},
        data={"current": current},
        followups=[_followup("TASK_TIME_ESTIMATE", "कितना समय लगेगा", "How long"),
                   _followup("TASK_NEXT", "अगला काम", "Next task")],
    )


def _task_next(ctx: dict) -> Reply:
    nxt = db.next_task(ctx["operator_id"], ctx["machine_id"])
    if not nxt:
        return Reply(text_hi="इसके बाद कोई और काम निर्धारित नहीं है। यह आज का आखिरी काम है।",
                     text_en="Nothing is scheduled after this. It is your last task today.",
                     card={"type": "tasks", "tasks": []})
    hi = ctx["task_hi"].get(nxt["id"], {})
    machine = db.machine(nxt["machine_id"])
    return Reply(
        text_hi=(f"अगला काम है: {hi.get('title') or nxt['title_en']}। "
                 f"मशीन: {machine['name_hi'] if machine else nxt['machine_id']}। "
                 f"शुरू करने का समय {nxt['planned_start']} बजे।"),
        text_en=(f"Your next task is: {nxt['title_en']}. "
                 f"Machine: {machine['name_en'] if machine else nxt['machine_id']}. "
                 f"Planned start {nxt['planned_start']}."),
        card={"type": "tasks", "tasks": [nxt], "current_id": nxt["id"]},
        data={"next": nxt},
    )


def _task_estimate(ctx: dict) -> Reply:
    operator_id, machine_id = ctx["operator_id"], ctx["machine_id"]
    current = db.active_task(operator_id, machine_id)
    if not current:
        return Reply(text_hi="अभी कोई काम चालू नहीं है, इसलिए समय का अनुमान नहीं लगा सकता।",
                     text_en="No task is active, so there is nothing to estimate.")

    progress = estimator.progress_of(current, machine_id)
    est = estimator.estimate(current, machine_id=machine_id, operator_id=operator_id, progress=progress)
    remaining = est["remaining_minutes"]
    finish = (datetime.now() + timedelta(minutes=remaining)).strftime("%H:%M")

    duration_hi, duration_en = _duration(remaining)

    text_hi = (f"इस काम में लगभग {duration_hi} और लगेंगे, यानी करीब {finish} बजे तक पूरा हो जाएगा। "
               f"पिछले {est['samples']} मिलते-जुलते कामों के आधार पर यह अनुमान है।")
    text_en = (f"About {duration_en} remain, so you should finish around {finish}. "
               f"This is based on {est['samples']} similar past jobs.")

    if est.get("factors"):
        top = est["factors"][0]
        sign_hi = "बढ़ा" if top["effect_pct"] > 0 else "घटा"
        text_hi += f" {top['label_hi']} ने समय {abs(top['effect_pct'])} प्रतिशत {sign_hi} दिया है।"
        text_en += f" {top['label_en']} changes it by {top['effect_pct']} percent."

    return Reply(
        text_hi=text_hi, text_en=text_en,
        card={"type": "estimate", "estimate": est, "task": current, "progress": round(progress, 3)},
        data=est,
        followups=[_followup("TASK_PROGRESS", "कितना हो गया", "Progress"),
                   _followup("WEATHER_CONDITIONS", "मौसम", "Weather")],
    )


def _task_progress(ctx: dict) -> Reply:
    operator_id, machine_id = ctx["operator_id"], ctx["machine_id"]
    current = db.active_task(operator_id, machine_id)
    if not current:
        return Reply(text_hi="अभी कोई काम चालू नहीं है।", text_en="No task is currently active.")

    progress = estimator.progress_of(current, machine_id)
    pct = round(progress * 100)
    target = current.get("target_cycles") or 0
    done = round(progress * target)

    if current["status"] == "pending":
        return Reply(
            text_hi=f"यह काम अभी शुरू नहीं हुआ है। शुरू करने पर मैं प्रगति बताता रहूँगा।",
            text_en="This task has not started yet. I will track progress once you start it.",
            card={"type": "progress", "progress": 0, "task": current},
        )
    return Reply(
        text_hi=f"काम {pct} प्रतिशत पूरा हो चुका है, {target} में से लगभग {done} साइकिल हो गए हैं।",
        text_en=f"The task is {pct} percent complete, about {done} of {target} cycles done.",
        card={"type": "progress", "progress": round(progress, 3), "task": current},
        data={"progress": progress, "cycles_done": done, "target_cycles": target},
    )


def _shift_summary(ctx: dict) -> Reply:
    machine_id, operator_id = ctx["machine_id"], ctx["operator_id"]
    snap = telemetry.snapshot(machine_id)
    fuel = telemetry.fuel_estimate(machine_id)
    health = anomaly.health_score(machine_id)
    tasks = db.tasks_for_operator(operator_id)
    done = sum(1 for t in tasks if t["status"] == "done")

    cycles = round(float(snap["sensors"].get("load_cycles", {}).get("value", 0) or 0))
    idle = round(float(snap["sensors"].get("idling_time_min", {}).get("value", 0) or 0))
    hours = round(snap["shift_elapsed_min"] / 60, 1)

    text_hi = (f"अब तक {hours} घंटे की शिफ्ट में {_num(cycles)} साइकिल पूरे हुए, "
               f"{_num(idle)} मिनट आइडलिंग रही और {len(tasks)} में से {done} काम पूरे हुए। "
               f"मशीन का स्वास्थ्य स्कोर {health['score']} है। ईंधन {_num(fuel['percent'])} प्रतिशत बचा है।")
    text_en = (f"In {hours} hours of the shift you have completed {_num(cycles)} cycles, "
               f"idled {_num(idle)} minutes, and finished {done} of {len(tasks)} tasks. "
               f"Machine health score is {health['score']}. Fuel remaining is {_num(fuel['percent'])} percent.")

    return Reply(
        text_hi=text_hi, text_en=text_en,
        severity="warn" if health["score"] < 75 else "ok",
        card={"type": "summary", "cycles": cycles, "idle": idle, "hours": hours,
              "health": health["score"], "fuel": fuel, "tasks_done": done, "tasks_total": len(tasks)},
        data={"health": health["score"], "fuel": fuel},
    )


def _productivity(ctx: dict) -> Reply:
    machine_id = ctx["machine_id"]
    snap = telemetry.snapshot(machine_id)
    base = anomaly.baseline(machine_id)
    hours = max(0.5, snap["shift_elapsed_min"] / 60)
    cycles = float(snap["sensors"].get("load_cycles", {}).get("value", 0) or 0)
    rate = cycles / hours
    norm = base["cycles_median"] or rate or 1.0
    delta = round((rate / norm - 1) * 100)

    if delta >= 5:
        verdict_hi, verdict_en, severity = "यह सामान्य से बेहतर है, बहुत अच्छा।", "That is better than normal, well done.", "ok"
    elif delta <= -15:
        verdict_hi, verdict_en, severity = "यह सामान्य से कम है।", "That is below the usual rate.", "warn"
    else:
        verdict_hi, verdict_en, severity = "यह सामान्य के आसपास है।", "That is around the usual rate.", "ok"

    return Reply(
        text_hi=f"आप प्रति घंटे {rate:.1f} साइकिल कर रहे हैं, सामान्य {norm:.1f} के मुकाबले। {verdict_hi}",
        text_en=f"You are averaging {rate:.1f} cycles per hour against a norm of {norm:.1f}. {verdict_en}",
        severity=severity,
        card={"type": "productivity", "rate": round(rate, 1), "norm": round(norm, 1), "delta_pct": delta},
        data={"rate": rate, "norm": norm, "delta_pct": delta},
    )


def _idle(ctx: dict) -> Reply:
    machine_id = ctx["machine_id"]
    snap = telemetry.snapshot(machine_id)
    reading = snap["sensors"].get("idling_time_min")
    if not reading:
        return Reply(text_hi="आइडल समय का डेटा उपलब्ध नहीं है।", text_en="Idle time data is not available.")
    minutes = round(float(reading["value"]))
    wasted = minutes / 60 * anomaly.IDLE_BURN_LPH
    pct = round(minutes / max(1, snap["shift_elapsed_min"]) * 100)

    text_hi = (f"आज मशीन {_num(minutes)} मिनट खाली चली है, जो शिफ्ट का {pct} प्रतिशत है। "
               f"इसमें लगभग {wasted:.1f} लीटर डीजल गया।")
    text_en = (f"The machine has idled {_num(minutes)} minutes today, {pct} percent of the shift, "
               f"burning about {wasted:.1f} litres of diesel.")
    if reading["status"] != "ok":
        text_hi += " तीन मिनट से ज़्यादा रुकना हो तो इंजन बंद कर दें।"
        text_en += " Shut the engine down for any wait longer than three minutes."

    return Reply(
        text_hi=text_hi, text_en=text_en,
        severity=SEVERITY_FROM_STATUS.get(reading["status"], "ok"),
        card={"type": "gauge", "reading": reading, "series": telemetry.recent_series(machine_id, "idling_time_min")},
        data={"idle_minutes": minutes, "wasted_litres": round(wasted, 1)},
    )


def _weather(ctx: dict) -> Reply:
    conditions = site.conditions(ctx["machine_id"])
    text_hi = (f"साइट पर {conditions['weather_hi']} है और तापमान {_num(conditions['ambient_temp_c'])} "
               f"डिग्री सेल्सियस है। काम की जगह पर {conditions['ground_hi']} है।")
    text_en = (f"Conditions on site: {conditions['weather_en'].lower()}, "
               f"{_num(conditions['ambient_temp_c'])} degrees celsius, {conditions['ground_en'].lower()} ground.")
    if conditions["advice_hi"]:
        text_hi += " " + conditions["advice_hi"]
        text_en += " " + conditions["advice_en"]
    return Reply(text_hi=text_hi, text_en=text_en,
                 card={"type": "weather", "conditions": conditions}, data=conditions)


def _training(ctx: dict) -> Reply:
    machine = db.machine(ctx["machine_id"])
    family = machine["family"] if machine else "all"
    modules = [m for m in db.TRAINING["modules"] if m["family"] in (family, "all")][:3]
    titles_hi = "، ".join(m["title_hi"] for m in modules)
    return Reply(
        text_hi=(f"इस मशीन के लिए {len(modules)} प्रशिक्षण मॉड्यूल उपलब्ध हैं: {titles_hi}। "
                 f"आप चाहें तो इंस्ट्रक्टर के साथ सत्र भी बुक कर सकते हैं।"),
        text_en=(f"{len(modules)} training modules are available for this machine: "
                 f"{', '.join(m['title_en'] for m in modules)}. You can also book an instructor session."),
        card={"type": "training", "modules": modules, "instructors": db.TRAINING["instructors"]},
        data={"modules": modules},
    )


def _how_to(ctx: dict) -> Reply:
    machine = db.machine(ctx["machine_id"])
    family = machine["family"] if machine else "all"
    current = db.active_task(ctx["operator_id"], ctx["machine_id"])
    skill = current["task_type"] if current else None
    modules = [m for m in db.TRAINING["modules"]
               if m["family"] in (family, "all") and (skill is None or m["skill_tag"] == skill)]
    modules = modules or [m for m in db.TRAINING["modules"] if m["family"] in (family, "all")]
    top = modules[0] if modules else None
    if not top:
        return Reply(text_hi="इसके लिए अभी कोई मार्गदर्शन उपलब्ध नहीं है।",
                     text_en="No guidance is available for that yet.")
    return Reply(
        text_hi=f"इसके लिए यह देखें: {top['title_hi']}। {top['summary_hi']} यह {top['duration_min']} मिनट का है।",
        text_en=f"Have a look at: {top['title_en']}. {top['summary_en']} It runs {top['duration_min']} minutes.",
        card={"type": "training", "modules": modules[:3], "instructors": db.TRAINING["instructors"]},
        data={"module": top},
    )


def _switch_machine(ctx: dict, slots: dict) -> Reply:
    family = slots.get("machine")
    target = next((m for m in db.MACHINES if m["family"] == family), None)
    if not target:
        names_hi = "، ".join(m["short_hi"] for m in db.MACHINES)
        return Reply(
            text_hi=f"कौन सी मशीन चाहिए? उपलब्ध हैं: {names_hi}।",
            text_en=f"Which machine do you want? Available: {', '.join(m['model'] for m in db.MACHINES)}.",
            card={"type": "machine_picker", "machines": db.MACHINES},
        )
    return Reply(
        text_hi=f"{target['name_hi']} चुन लिया गया है। अब इसी मशीन की जानकारी मिलेगी।",
        text_en=f"Switched to the {target['name_en']}. All answers now refer to this machine.",
        card={"type": "machine_switch", "machine": target},
        data={"machine_id": target["id"]},
    )


def _greeting(ctx: dict) -> Reply:
    operator = db.operator(ctx["operator_id"]) or {}
    machine = db.machine(ctx["machine_id"]) or {}
    hour = datetime.now().hour
    greet_hi = "सुप्रभात" if hour < 12 else ("नमस्ते" if hour < 17 else "शुभ संध्या")
    greet_en = "Good morning" if hour < 12 else ("Hello" if hour < 17 else "Good evening")
    return Reply(
        text_hi=f"{greet_hi} {operator.get('name_hi', '')}! {machine.get('name_hi', '')} तैयार है। मैं आपकी क्या मदद करूँ?",
        text_en=f"{greet_en} {operator.get('name_en', '')}! The {machine.get('name_en', '')} is ready. How can I help?",
        card=None,
    )


def _help(ctx: dict) -> Reply:
    machine = db.machine(ctx["machine_id"]) or {}
    questions_hi = machine.get("quick_questions_hi", [])[:4]
    questions_en = machine.get("quick_questions_en", [])[:4]
    return Reply(
        text_hi=("मैं मशीन की स्थिति, ईंधन, सुरक्षा, आज के काम और समय के अनुमान के बारे में बता सकता हूँ। "
                 f"जैसे आप पूछ सकते हैं: {' '.join(questions_hi)}"),
        text_en=("I can tell you about machine status, fuel, safety, today's tasks and time estimates. "
                 f"For example: {' '.join(questions_en)}"),
        card={"type": "suggestions", "questions_hi": questions_hi, "questions_en": questions_en},
    )


def _unsupported(ctx: dict, intent: str) -> Reply:
    machine = db.machine(ctx["machine_id"]) or {}
    spec = INTENTS.get(intent)
    what_hi = spec.description if spec else intent
    return Reply(
        text_hi=(f"{machine.get('name_hi', 'यह मशीन')} पर यह सेंसर उपलब्ध नहीं है, इसलिए यह जानकारी नहीं दे सकता। "
                 f"आप ईंधन, तापमान, सुरक्षा या आज के काम के बारे में पूछ सकते हैं।"),
        text_en=(f"The {machine.get('name_en', 'selected machine')} does not have that sensor, so I cannot answer it. "
                 f"You can ask about fuel, temperature, safety or today's tasks."),
        severity="ok",
        card={"type": "unsupported", "intent": intent, "machine": machine.get("name_en"), "what": what_hi},
    )


def _unknown(ctx: dict, alternatives: list[dict]) -> Reply:
    machine = db.machine(ctx["machine_id"]) or {}
    suggestions = machine.get("quick_questions_hi", [])[:3]
    suggestions_en = machine.get("quick_questions_en", [])[:3]
    if alternatives:
        labels_hi = "، ".join(
            (INTENTS[a["intent"]].description if a["intent"] in INTENTS else a["intent"])
            for a in alternatives[:2]
        )
        text_hi = f"मैं ठीक से समझ नहीं पाया। क्या आप यह पूछना चाहते थे: {labels_hi}?"
        text_en = f"I did not quite catch that. Did you mean: {labels_hi}?"
    else:
        text_hi = f"माफ़ कीजिए, मैं समझ नहीं पाया। आप ऐसे पूछ सकते हैं: {' '.join(suggestions)}"
        text_en = f"Sorry, I did not understand. You could ask: {' '.join(suggestions_en)}"
    return Reply(
        text_hi=text_hi, text_en=text_en, severity="ok",
        card={"type": "clarify", "alternatives": alternatives,
              "questions_hi": suggestions, "questions_en": suggestions_en},
    )


# --------------------------------------------------------------------------
# dispatch
# --------------------------------------------------------------------------
_HANDLERS = {
    "FUEL_STATUS": _fuel,
    "MACHINE_HEALTH": _machine_health,
    "ANOMALY_STATUS": _anomalies,
    "ACTIVE_ALERTS": _alerts,
    "MAINTENANCE_DUE": _maintenance,
    "SAFETY_STATUS": _safety_status,
    "SEATBELT_STATUS": _seatbelt,
    "PROXIMITY_HAZARD": _proximity,
    "REPORT_INCIDENT": _report_incident,
    "TASK_TODAY": _task_today,
    "TASK_NEXT": _task_next,
    "TASK_TIME_ESTIMATE": _task_estimate,
    "TASK_PROGRESS": _task_progress,
    "SHIFT_SUMMARY": _shift_summary,
    "PRODUCTIVITY": _productivity,
    "IDLE_TIME": _idle,
    "WEATHER_CONDITIONS": _weather,
    "TRAINING_HELP": _training,
    "HOW_TO_OPERATE": _how_to,
    "GREETING": _greeting,
    "HELP": _help,
}


def build(intent: str, *, machine_id: str, operator_id: str, slots: dict | None = None,
          alternatives: list[dict] | None = None, unsupported: bool = False,
          task_hi: dict | None = None) -> dict:
    """Intent + machine context -> a bilingual, speakable answer."""
    ctx = {"machine_id": machine_id, "operator_id": operator_id, "task_hi": task_hi or {}}
    slots = slots or {}

    if unsupported:
        return _unsupported(ctx, intent).as_dict()
    if intent == "UNKNOWN":
        return _unknown(ctx, alternatives or []).as_dict()
    if intent == "SWITCH_MACHINE":
        return _switch_machine(ctx, slots).as_dict()

    handler = _HANDLERS.get(intent)
    if handler is not None:
        return handler(ctx).as_dict()

    # Everything else is a plain sensor lookup driven by the taxonomy.
    spec = INTENTS.get(intent)
    if spec and spec.sensors:
        reply = _sensor_reply(machine_id, spec.sensors)
        if reply is not None:
            return reply.as_dict()
        return _unsupported(ctx, intent).as_dict()

    return _unknown(ctx, alternatives or []).as_dict()
