"""Unusual-behaviour detection.

The brief asks for "unusual behaviour in machine usage, e.g. excessive idling or
unsafe operation patterns". That does not need a model. It needs the machine's
own history as a baseline and a handful of well chosen rules, which have the
enormous advantage that every finding can be explained to the operator in one
sentence - and explained in Hindi.

Each detector returns evidence (the numbers it fired on) and a recommendation,
so the UI can show *why* something was flagged rather than just that it was.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from .. import db
from . import telemetry

IDLE_BURN_LPH = 4.2        # a CAT diesel at idle
DIESEL_COST_PER_L = 92.0   # INR, for the "this cost you X rupees" line


@dataclass
class Finding:
    code: str
    severity: str                      # info | warning | critical
    title_en: str
    title_hi: str
    detail_en: str
    detail_hi: str
    recommendation_en: str
    recommendation_hi: str
    evidence: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "code": self.code, "severity": self.severity,
            "title": {"en": self.title_en, "hi": self.title_hi},
            "detail": {"en": self.detail_en, "hi": self.detail_hi},
            "recommendation": {"en": self.recommendation_en, "hi": self.recommendation_hi},
            "evidence": self.evidence,
        }


# --------------------------------------------------------------------------
# historical baselines
# --------------------------------------------------------------------------
def _floats(rows: list[dict], column: str) -> list[float]:
    out: list[float] = []
    for row in rows:
        raw = row.get(column, "")
        if raw in ("", None):
            continue
        try:
            out.append(float(raw))
        except ValueError:
            continue
    return out


def baseline(machine_id: str) -> dict:
    """What 'normal' looks like for this specific machine, from its own history."""
    rows = db.telemetry_history(machine_id, limit=10_000)
    idle = _floats(rows, "Idling Time (min)")
    cycles = _floats(rows, "Load Cycles")
    fuel = _floats(rows, "Fuel Used (L)")
    belts = [r.get("Seatbelt Status", "") for r in rows]
    proximity = [r.get("Proximity Event", "No") for r in rows]

    working = [c for c in cycles if c > 0]
    fuel_per_cycle = [f / c for f, c in zip(fuel, cycles) if c > 0 and f > 0]

    return {
        "samples": len(rows),
        "idle_median": statistics.median(idle) if idle else 0.0,
        "idle_p90": (statistics.quantiles(idle, n=10)[8] if len(idle) > 10 else (max(idle) if idle else 0.0)),
        "cycles_median": statistics.median(working) if working else 0.0,
        "fuel_per_cycle_median": statistics.median(fuel_per_cycle) if fuel_per_cycle else 0.0,
        "fuel_per_cycle_stdev": statistics.pstdev(fuel_per_cycle) if len(fuel_per_cycle) > 1 else 0.0,
        "belt_violation_rate": (sum(1 for b in belts if b == "Unfastened") / len(belts)) if belts else 0.0,
        "proximity_rate": (sum(1 for p in proximity if p == "Yes") / len(proximity)) if proximity else 0.0,
    }


# --------------------------------------------------------------------------
# detectors
# --------------------------------------------------------------------------
def _idling(snap: dict, base: dict) -> Finding | None:
    idle = snap["sensors"].get("idling_time_min")
    if not idle or not isinstance(idle["value"], (int, float)):
        return None
    minutes = float(idle["value"])
    elapsed = max(1.0, snap["shift_elapsed_min"])
    ratio = minutes / elapsed

    if ratio < 0.10 and idle["status"] == "ok":
        return None

    wasted_l = minutes / 60.0 * IDLE_BURN_LPH
    cost = wasted_l * DIESEL_COST_PER_L
    severity = "critical" if idle["status"] == "crit" or ratio > 0.22 else "warning"
    pct = round(ratio * 100)

    return Finding(
        code="EXCESSIVE_IDLING",
        severity=severity,
        title_en="Excessive idling",
        title_hi="ज़रूरत से ज़्यादा आइडलिंग",
        detail_en=(f"The machine has idled {round(minutes)} minutes so far, which is {pct}% of the "
                   f"shift and above this machine's usual {round(base['idle_median'])} minutes per hour block. "
                   f"That burned about {wasted_l:.1f} litres of diesel."),
        detail_hi=(f"मशीन अब तक {round(minutes)} मिनट खाली चली है, जो शिफ्ट का {pct} प्रतिशत है। "
                   f"इससे लगभग {wasted_l:.1f} लीटर डीजल बेकार गया, यानी करीब {round(cost)} रुपये।"),
        recommendation_en="Shut the engine down whenever you expect to wait more than three minutes.",
        recommendation_hi="जब भी तीन मिनट से ज़्यादा इंतज़ार करना हो, इंजन बंद कर दें।",
        evidence={"idle_minutes": round(minutes), "shift_pct": pct,
                  "wasted_litres": round(wasted_l, 1), "wasted_rupees": round(cost),
                  "machine_median": round(base["idle_median"], 1)},
    )


def _seatbelt(snap: dict, base: dict) -> Finding | None:
    belt = snap["sensors"].get("seatbelt")
    if not belt:
        return None
    rate = base["belt_violation_rate"]
    live_violation = belt["value"] == "Unfastened"
    if not live_violation and rate < 0.05:
        return None

    if live_violation:
        return Finding(
            code="SEATBELT_UNFASTENED",
            severity="critical",
            title_en="Seatbelt not fastened",
            title_hi="सीट बेल्ट नहीं लगी है",
            detail_en="The seatbelt is currently unfastened while the machine is powered.",
            detail_hi="मशीन चालू है और आपकी सीट बेल्ट अभी नहीं लगी है।",
            recommendation_en="Fasten the seatbelt now. Operating without it is a reportable violation.",
            recommendation_hi="अभी सीट बेल्ट लगाएँ। बिना बेल्ट मशीन चलाना नियम का उल्लंघन है।",
            evidence={"status": belt["value"], "historic_violation_rate": round(rate, 3)},
        )
    return Finding(
        code="SEATBELT_PATTERN",
        severity="warning",
        title_en="Repeated seatbelt violations",
        title_hi="सीट बेल्ट बार-बार नहीं लगाई गई",
        detail_en=f"The seatbelt was unfastened in {round(rate * 100)}% of recent readings for this machine.",
        detail_hi=f"इस मशीन की हाल की {round(rate * 100)} प्रतिशत रीडिंग में सीट बेल्ट नहीं लगी थी।",
        recommendation_en="Make fastening the belt part of the start-up routine, before releasing the parking brake.",
        recommendation_hi="पार्किंग ब्रेक छोड़ने से पहले बेल्ट लगाना अपनी आदत बनाएँ।",
        evidence={"violation_rate": round(rate, 3)},
    )


def _thermal(snap: dict) -> list[Finding]:
    out: list[Finding] = []
    for key in ("engine_temp_c", "hydraulic_temp_c", "transmission_temp_c"):
        reading = snap["sensors"].get(key)
        if not reading or reading["status"] == "ok" or not isinstance(reading["value"], (int, float)):
            continue
        severity = "critical" if reading["status"] == "crit" else "warning"
        out.append(
            Finding(
                code=f"THERMAL_{key.upper()}",
                severity=severity,
                title_en=f"{reading['label_en']} high",
                title_hi=f"{reading['label_hi']} ज़्यादा है",
                detail_en=f"{reading['label_en']} is {reading['value']}{reading['unit']}, above the safe limit.",
                detail_hi=f"{reading['label_hi']} {reading['value']}{reading['unit']} है, जो सुरक्षित सीमा से ऊपर है।",
                recommendation_en="Drop to a lighter duty cycle and let the machine cool before continuing.",
                recommendation_hi="काम का भार कम करें और मशीन को ठंडा होने दें, फिर आगे बढ़ें।",
                evidence={"sensor": key, "value": reading["value"],
                          "warn_above": reading.get("warn_above"), "crit_above": reading.get("crit_above")},
            )
        )
    return out


def _productivity(snap: dict, base: dict) -> Finding | None:
    cycles = snap["sensors"].get("load_cycles")
    if not cycles or not isinstance(cycles["value"], (int, float)):
        return None
    hours = max(0.5, snap["shift_elapsed_min"] / 60.0)
    rate = float(cycles["value"]) / hours
    expected = base["cycles_median"] or 10.0
    if rate >= expected * 0.65:
        return None
    shortfall = round((1 - rate / expected) * 100)
    return Finding(
        code="LOW_CYCLE_RATE",
        severity="info",
        title_en="Cycle rate below this machine's norm",
        title_hi="साइकिल दर सामान्य से कम है",
        detail_en=(f"You are averaging {rate:.1f} cycles per hour against a usual {expected:.1f} "
                   f"for this machine, about {shortfall}% lower."),
        detail_hi=(f"आप प्रति घंटे {rate:.1f} साइकिल कर रहे हैं जबकि इस मशीन का सामान्य {expected:.1f} है, "
                   f"यानी करीब {shortfall} प्रतिशत कम।"),
        recommendation_en="Check for waiting time on trucks, and shorten the swing angle where you can.",
        recommendation_hi="ट्रक के इंतज़ार का समय देखें और जहाँ संभव हो स्विंग का कोण छोटा रखें।",
        evidence={"cycles_per_hour": round(rate, 1), "machine_norm": round(expected, 1), "shortfall_pct": shortfall},
    )


def _fuel_burn(snap: dict, base: dict) -> Finding | None:
    median, stdev = base["fuel_per_cycle_median"], base["fuel_per_cycle_stdev"]
    cycles = snap["sensors"].get("load_cycles")
    if not median or not stdev or not cycles or not isinstance(cycles["value"], (int, float)):
        return None

    machine = db.machine(snap["machine_id"])
    fuel_used = machine["fuel_capacity_l"] * (
        (telemetry.BASELINE[snap["machine_id"]]["fuel_level_pct"] - float(snap["sensors"]["fuel_level_pct"]["value"]))
        / 100.0
    )
    done = float(cycles["value"]) or 1.0
    per_cycle = fuel_used / done
    z = (per_cycle - median) / stdev
    if z < 2.0:
        return None
    return Finding(
        code="FUEL_BURN_OUTLIER",
        severity="warning",
        title_en="Fuel burn per cycle is unusually high",
        title_hi="प्रति साइकिल ईंधन खपत असामान्य रूप से ज़्यादा",
        detail_en=(f"This shift is using {per_cycle:.2f} litres per cycle against a normal "
                   f"{median:.2f}, which is {z:.1f} standard deviations high."),
        detail_hi=(f"इस शिफ्ट में प्रति साइकिल {per_cycle:.2f} लीटर खर्च हो रहा है जबकि सामान्य "
                   f"{median:.2f} लीटर है।"),
        recommendation_en="Usually caused by idling between loads or over-revving. Ease the throttle between cycles.",
        recommendation_hi="यह आमतौर पर लोड के बीच आइडलिंग या ज़्यादा रेस देने से होता है। साइकिल के बीच थ्रॉटल कम रखें।",
        evidence={"litres_per_cycle": round(per_cycle, 2), "normal": round(median, 2), "z_score": round(z, 1)},
    )


def _maintenance(machine_id: str) -> Finding | None:
    status = telemetry.maintenance_status(machine_id)
    if not status["overdue"] and not status["due_soon"]:
        return None
    if status["overdue"]:
        over = abs(status["hours_remaining"])
        return Finding(
            code="SERVICE_OVERDUE",
            severity="critical",
            title_en="Service overdue",
            title_hi="सर्विस की तारीख निकल चुकी है",
            detail_en=f"The machine is {over:.0f} hours past its {status['interval_hours']} hour service interval.",
            detail_hi=f"मशीन अपनी {status['interval_hours']} घंटे की सर्विस से {over:.0f} घंटे आगे निकल चुकी है।",
            recommendation_en="Report to the workshop before the next shift.",
            recommendation_hi="अगली शिफ्ट से पहले वर्कशॉप को सूचित करें।",
            evidence=status,
        )
    return Finding(
        code="SERVICE_DUE_SOON",
        severity="info",
        title_en="Service due soon",
        title_hi="सर्विस जल्द होनी है",
        detail_en=f"{status['hours_remaining']:.0f} engine hours remain before the next scheduled service.",
        detail_hi=f"अगली सर्विस में {status['hours_remaining']:.0f} इंजन घंटे बाकी हैं।",
        recommendation_en="Plan the service into this week's schedule.",
        recommendation_hi="इस हफ्ते की योजना में सर्विस शामिल करें।",
        evidence=status,
    )


def _proximity(snap: dict, base: dict) -> Finding | None:
    reading = snap["sensors"].get("proximity_objects")
    if not reading or not reading["value"]:
        return None
    return Finding(
        code="PROXIMITY_ACTIVE",
        severity="critical",
        title_en="Object detected in the danger zone",
        title_hi="खतरे के क्षेत्र में कोई वस्तु है",
        detail_en=f"{reading['value']} object(s) are inside the machine's proximity zone right now.",
        detail_hi=f"अभी मशीन के नज़दीकी क्षेत्र में {reading['value']} वस्तु मौजूद है।",
        recommendation_en="Stop all movement, sound the horn, and confirm the area is clear before continuing.",
        recommendation_hi="सभी हरकत रोकें, हॉर्न बजाएँ और क्षेत्र खाली होने की पुष्टि के बाद ही आगे बढ़ें।",
        evidence={"objects": reading["value"], "historic_rate": round(base["proximity_rate"], 3)},
    )


# Sensors that already have a dedicated detector above.
_HANDLED_ELSEWHERE = {
    "seatbelt", "proximity_objects", "idling_time_min",
    "engine_temp_c", "hydraulic_temp_c", "transmission_temp_c",
}


def _threshold_sensors(snap: dict, already: set[str]) -> list[Finding]:
    """Catch-all so no out-of-range reading is ever silently dropped."""
    out: list[Finding] = []
    for key, reading in snap["sensors"].items():
        if reading["status"] not in ("warn", "crit") or key in _HANDLED_ELSEWHERE:
            continue
        if any(key.upper() in code for code in already):
            continue

        critical = reading["status"] == "crit"
        limit = reading.get("crit_below") if critical else reading.get("warn_below")
        direction_low = limit is not None
        out.append(
            Finding(
                code=f"{'CRITICAL' if critical else 'WARNING'}_{key.upper()}",
                severity="critical" if critical else "warning",
                title_en=f"{reading['label_en']} {'critical' if critical else 'outside normal range'}",
                title_hi=f"{reading['label_hi']} {'खतरनाक स्तर पर है' if critical else 'सामान्य सीमा से बाहर है'}",
                detail_en=(f"{reading['label_en']} reads {reading['value']}{reading['unit']}, "
                           f"{'below' if direction_low else 'above'} the acceptable limit."),
                detail_hi=(f"{reading['label_hi']} अभी {reading['value']}{reading['unit']} है, जो "
                           f"{'तय सीमा से कम' if direction_low else 'तय सीमा से ज़्यादा'} है।"),
                recommendation_en=("Stop work and call maintenance before continuing."
                                   if critical else "Report it at the next break so it can be corrected."),
                recommendation_hi=("काम रोकें और आगे बढ़ने से पहले मेंटेनेंस को बुलाएँ।"
                                   if critical else "अगले ब्रेक पर इसकी सूचना दें ताकि इसे ठीक किया जा सके।"),
                evidence={"sensor": key, "value": reading["value"], "status": reading["status"]},
            )
        )
    return out


def _unusual_use(machine_id: str) -> Finding | None:
    """Hours in the last three shifts that the unusual-use model flagged."""
    from ..ml import unusual_use

    hours = unusual_use.scan(machine_id, db.telemetry_history(machine_id, limit=27))
    # An hour the model finds odd but cannot put into words is not worth an
    # operator's attention.
    hours = [h for h in hours if h["kind"] != "other"]
    if not hours:
        return None
    worst = hours[0]
    when = worst["timestamp"][5:16]
    others = len(hours) - 1
    more_en = f" {others} more unusual hour(s) in the last three shifts." if others else ""
    more_hi = f" पिछली तीन शिफ्ट में ऐसे {others} और घंटे मिले।" if others else ""
    return Finding(
        code="UNUSUAL_USE",
        severity="warning",
        title_en="Unusual use of the machine",
        title_hi="मशीन का असामान्य इस्तेमाल",
        detail_en=f"{when}: {worst['text']['en']}{more_en}",
        detail_hi=f"{worst['text']['hi']}{more_hi}",
        recommendation_en="Check the log for this hour with the operator.",
        recommendation_hi="इस घंटे के बारे में ऑपरेटर से बात करें।",
        evidence={"hours": hours[:5]},
    )


SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}


def analyse(machine_id: str) -> list[dict]:
    """Every finding for this machine right now, most serious first."""
    snap = telemetry.snapshot(machine_id)
    base = baseline(machine_id)

    findings: list[Finding] = []
    for detector in (_idling, _seatbelt, _productivity, _fuel_burn):
        found = detector(snap, base)
        if found:
            findings.append(found)
    findings.extend(_thermal(snap))
    found = _proximity(snap, base)
    if found:
        findings.append(found)
    found = _maintenance(machine_id)
    if found:
        findings.append(found)
    found = _unusual_use(machine_id)
    if found:
        findings.append(found)
    findings.extend(_threshold_sensors(snap, {f.code for f in findings}))

    findings.sort(key=lambda f: SEVERITY_ORDER.get(f.severity, 3))
    return [f.as_dict() for f in findings]


def health_score(machine_id: str) -> dict:
    """0-100 roll-up, with the deductions that produced it."""
    findings = analyse(machine_id)
    penalty = {"critical": 22, "warning": 10, "info": 3}
    score = 100
    for finding in findings:
        score -= penalty.get(finding["severity"], 0)
    score = max(0, score)
    grade = "good" if score >= 80 else "fair" if score >= 60 else "poor"
    return {
        "score": score,
        "grade": grade,
        "findings": findings,
        "counts": {
            sev: sum(1 for f in findings if f["severity"] == sev)
            for sev in ("critical", "warning", "info")
        },
    }
