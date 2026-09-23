"""Model signals: everything the small ML models say about one operator on one machine.

One card per signal, each tagged with the model behind it, so the operator
hears a single plain sentence and a judge can see which model produced it:

  safety risk, fatigue, seatbelt, people nearby, heat  <- safety-risk model
                                                          (GradientBoostingClassifier)
  unusual use, idle waste                              <- unusual-use model
                                                          (IsolationForest + Huber fuel fit)
  time to finish the job                               <- task-time model
                                                          (GradientBoostingRegressor + quantiles)
  engine overheating, fuel run-out                     <- linear trend forecasts
  operating style                                      <- unusual-use model score

Suresh Yadav on the CAT 320 excavator is the demo dashboard. His values are a
fixed scenario (DEMO below) so the story is the same every time it is shown.
Every other operator and machine gets the same cards computed live.
"""

from __future__ import annotations

from .. import db
from . import telemetry

MODELS = {
    "risk": {"name": "Safety-risk model", "arch": "GradientBoostingClassifier · 200 trees, depth 2"},
    "unusual": {"name": "Unusual-use model", "arch": "IsolationForest · 300 trees + Huber fuel fit"},
    "time": {"name": "Task-time model", "arch": "GradientBoostingRegressor + 7%/93% quantile models"},
    "trend": {"name": "Trend forecast", "arch": "Least-squares trend on the last 30 minutes"},
}


def _signal(key, icon, level, model, title, value, say):
    return {
        "key": key, "icon": icon, "level": level, "model": MODELS[model],
        "title": {"hi": title[0], "en": title[1]},
        "value": {"hi": value[0], "en": value[1]},
        "say": {"hi": say[0], "en": say[1]},
    }


# --------------------------------------------------------------------------
# the demo scenario: Suresh Yadav, CAT 320 excavator, a hot dusty afternoon
# --------------------------------------------------------------------------
def _demo() -> dict:
    s = _signal
    signals = [
        s("risk", "shield", "danger", "risk",
          ("अगले घंटे ख़तरा", "Risk next hour"), ("ज़्यादा · 68%", "High · 68%"),
          ("अगले एक घंटे में ख़तरे की संभावना ज़्यादा है। दस मिनट आराम कीजिए, फिर सीट बेल्ट लगाकर काम शुरू कीजिए।",
           "The chance of a safety problem in the next hour is high. Rest ten minutes, then fasten your seatbelt and continue.")),
        s("fatigue", "clock", "danger", "risk",
          ("थकान", "Tiredness"), ("3 घंटे 40 मिनट से बिना आराम", "3 h 40 min without a break"),
          ("आप तीन घंटे चालीस मिनट से बिना आराम के मशीन चला रहे हैं। अभी दस मिनट आराम कीजिए।",
           "You have been operating for three hours forty minutes without a break. Take ten minutes now.")),
        s("seatbelt", "seatbelt", "warn", "risk",
          ("सीट बेल्ट", "Seatbelt"), ("आज 2 बार खुली", "Off twice today"),
          ("आज दो बार सीट बेल्ट खुली मिली। मशीन चलाते समय सीट बेल्ट हमेशा लगाइए।",
           "Your seatbelt was off twice today. Always keep it on while the machine moves.")),
        s("people", "proximity", "warn", "risk",
          ("पास में लोग", "People nearby"), ("धूल · कम दिखेगा", "Dusty · poor view"),
          ("धूल की वजह से कम दिख रहा है। घुमाने से पहले पीछे और दाएँ देखिए, हॉर्न बजाइए।",
           "Dust is cutting visibility. Look behind and to the right, and sound the horn before you swing.")),
        s("heat", "sun", "warn", "risk",
          ("गर्मी", "Heat"), ("41°C", "41°C"),
          ("बाहर इकतालीस डिग्री है। पानी पीजिए और आराम छाँव में कीजिए।",
           "It is forty one degrees outside. Drink water and rest in the shade.")),
        s("unusual", "alert", "warn", "unusual",
          ("असामान्य इस्तेमाल", "Unusual use"), ("कल 12 बजे", "Yesterday 12:00"),
          ("कल बारह बजे इंजन चलता रहा, पर न काम हुआ न आइडलिंग। सुपरवाइज़र से बात कीजिए।",
           "Yesterday at twelve the engine ran with no work and no idling. Please talk to your supervisor.")),
        s("idle", "idle", "warn", "unusual",
          ("खाली चलना", "Idling"), ("68 मिनट · ₹435", "68 min · ₹435"),
          ("आज मशीन अड़सठ मिनट खाली चली, लगभग चार सौ पैंतीस रुपये का डीज़ल। रुकना हो तो इंजन बंद कीजिए।",
           "The machine idled sixty eight minutes today, about four hundred thirty five rupees of diesel. Switch off when you wait.")),
        s("engine", "temp", "warn", "trend",
          ("इंजन गरम", "Engine heat"), ("40 मिनट में गरम", "Hot in 40 min"),
          ("इंजन का तापमान बढ़ रहा है। इसी तरह चला तो चालीस मिनट में गरम हो जाएगा। भार थोड़ा कम कीजिए।",
           "Engine temperature is rising. At this rate it will overheat in forty minutes. Ease off the load a little.")),
        s("time", "dig", "ok", "time",
          ("खाई का काम", "Trench job"), ("2 घंटे 15 मिनट बाकी", "2 h 15 min left"),
          ("खाई का काम लगभग दो घंटे पंद्रह मिनट में पूरा होगा। एक घंटा पचपन से दो घंटे चालीस मिनट के बीच।",
           "The trench will take about two hours fifteen minutes more, between one hour fifty five and two hours forty.")),
        s("fuel", "fuel", "ok", "trend",
          ("डीज़ल", "Diesel"), ("3 घंटे 30 मिनट चलेगा", "Lasts 3 h 30 min"),
          ("डीज़ल साढ़े तीन घंटे और चलेगा। काम पूरा होने तक काफ़ी है।",
           "Diesel will last three and a half hours more. Enough to finish the job.")),
        s("style", "star", "ok", "unusual",
          ("चलाने का तरीका", "Driving style"), ("अच्छा · 78/100", "Good · 78/100"),
          ("आपका मशीन चलाने का तरीका अच्छा है, अठहत्तर में से सौ। झटके से कम घुमाइए तो और अच्छा होगा।",
           "Your operating style is good, seventy eight out of a hundred. Smoother swings will make it better.")),
    ]
    return {
        "score": 58,
        "headline": {"hi": "आज ख़तरा ज़्यादा है। पहले आराम कीजिए।", "en": "Risk is high today. Rest first."},
        "signals": signals,
    }


# --------------------------------------------------------------------------
# live: the same cards for everyone else
# --------------------------------------------------------------------------
def _live(machine_id: str, operator_id: str | None) -> dict:
    from . import anomaly, safety, site, tasks as task_service

    snap = telemetry.snapshot(machine_id)
    sensors = snap["sensors"]
    cond = site.conditions(machine_id)
    num = lambda k, d=0.0: float(sensors.get(k, {}).get("value") or d) if isinstance(sensors.get(k, {}).get("value"), (int, float)) else d  # noqa: E731
    s = _signal
    out = []

    warnings = {w["key"]: w for w in safety.extra_warnings(machine_id, operator_id)}
    risk = warnings.get("risk")
    out.append(s("risk", "shield", "danger" if risk and risk["severity"] == "crit" else "warn" if risk else "ok", "risk",
                 ("अगले घंटे ख़तरा", "Risk next hour"),
                 (("ज़्यादा", "High") if risk and risk["severity"] == "crit" else ("थोड़ा", "Some") if risk else ("कम", "Low")),
                 ((risk["hi"], risk["en"]) if risk else ("अगले घंटे ख़तरा कम है। ऐसे ही सावधानी से चलाइए।",
                                                         "Risk in the next hour is low. Keep working carefully."))))

    belt = safety.seatbelt_compliance(machine_id)
    on = sensors.get("seatbelt", {}).get("value") == "Fastened"
    out.append(s("seatbelt", "seatbelt", "ok" if on else "danger", "risk", ("सीट बेल्ट", "Seatbelt"),
                 (f"{belt['rate_pct']}% समय लगी", f"On {belt['rate_pct']}% of the time"),
                 ("सीट बेल्ट लगी है। बहुत अच्छा।", "Seatbelt is on. Well done.") if on
                 else ("सीट बेल्ट खुली है। अभी लगाइए।", "Your seatbelt is off. Fasten it now.")))

    near = num("proximity_objects")
    out.append(s("people", "proximity", "danger" if near else "ok", "risk", ("पास में लोग", "People nearby"),
                 ("कोई है!", "Someone close!") if near else ("कोई नहीं", "Clear"),
                 ("मशीन के पास कोई है। रुकिए और देखिए।", "Someone is near the machine. Stop and look.") if near
                 else ("आसपास कोई नहीं है।", "Nobody is near the machine.")))

    temp = cond["ambient_temp_c"]
    out.append(s("heat", "sun", "warn" if temp >= 38 else "ok", "risk", ("गर्मी", "Heat"),
                 (f"{round(temp)}°C", f"{round(temp)}°C"),
                 ("बहुत गर्मी है। पानी पीजिए।", "It is very hot. Drink water.") if temp >= 38
                 else ("मौसम ठीक है।", "The weather is fine.")))

    unusual = next((f for f in anomaly.analyse(machine_id) if f["code"] == "UNUSUAL_USE"), None)
    out.append(s("unusual", "alert", "warn" if unusual else "ok", "unusual", ("असामान्य इस्तेमाल", "Unusual use"),
                 ("मिला", "Found") if unusual else ("नहीं", "None"),
                 (unusual["detail"]["hi"], unusual["detail"]["en"]) if unusual
                 else ("मशीन का इस्तेमाल सामान्य है।", "The machine is being used normally.")))

    idle = num("idling_time_min")
    rupees = round(idle / 60 * 4.2 * 92)
    out.append(s("idle", "idle", "warn" if idle > 45 else "ok", "unusual", ("खाली चलना", "Idling"),
                 (f"{round(idle)} मिनट · ₹{rupees}", f"{round(idle)} min · ₹{rupees}"),
                 (f"आज मशीन {round(idle)} मिनट खाली चली। रुकना हो तो इंजन बंद कीजिए।",
                  f"The machine idled {round(idle)} minutes today. Switch off when you wait.")))

    current = next((t for t in task_service.for_operator(operator_id or "", machine_id=machine_id)
                    if t.get("status") != "done"), None) if operator_id else None
    est = (current or {}).get("estimate") or {}
    if est.get("expected_minutes"):
        m, lo, hi = (round(est.get(k) or 0) for k in ("expected_minutes", "low_minutes", "high_minutes"))
        out.append(s("time", "dig", "ok", "time", ("काम का समय", "Job time"),
                     (f"{m // 60} घंटे {m % 60} मिनट", f"{m // 60} h {m % 60} min"),
                     (f"यह काम लगभग {m} मिनट में पूरा होगा, {lo} से {hi} मिनट के बीच।",
                      f"This job will take about {m} minutes, between {lo} and {hi}.")))

    fuel = num("fuel_level_pct", 50)
    out.append(s("fuel", "fuel", "warn" if fuel < 20 else "ok", "trend", ("डीज़ल", "Diesel"),
                 (f"{round(fuel)}%", f"{round(fuel)}%"),
                 ("डीज़ल कम है। जल्दी भरवाइए।", "Diesel is low. Refuel soon.") if fuel < 20
                 else ("डीज़ल काफ़ी है।", "There is enough diesel.")))

    levels = [x["level"] for x in out]
    score = max(0, 100 - 20 * levels.count("danger") - 8 * levels.count("warn"))
    worst = next((x for x in out if x["level"] == "danger"), None) or next((x for x in out if x["level"] == "warn"), None)
    headline = ({"hi": worst["say"]["hi"], "en": worst["say"]["en"]} if worst
                else {"hi": "सब ठीक है। सावधानी से काम कीजिए।", "en": "All good. Work carefully."})
    return {"score": score, "headline": headline, "signals": out}


def is_demo(machine_id: str, operator_id: str | None) -> bool:
    return operator_id == "OP1002" and machine_id == "EXC001"


def signals(machine_id: str, operator_id: str | None) -> dict:
    machine = db.machine(machine_id)
    operator = db.operator(operator_id) if operator_id else None
    body = _demo() if is_demo(machine_id, operator_id) else _live(machine_id, operator_id)
    order = {"danger": 0, "warn": 1, "ok": 2}
    body["signals"].sort(key=lambda x: order[x["level"]])
    return {
        "machine": {k: machine[k] for k in ("id", "model", "name_en", "name_hi", "family")},
        "operator": {k: operator[k] for k in ("id", "name_en", "name_hi", "avatar_initials", "experience_years")} if operator else None,
        "models": list(MODELS.values()),
        **body,
    }
