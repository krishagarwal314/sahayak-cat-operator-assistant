"""Intent taxonomy for the operator assistant.

This single file is the source of truth for three different consumers:

  1. the rule matcher      -> `keywords`
  2. the embedding router  -> `examples` (encoded once into a prototype bank)
  3. the trainable model   -> `examples` seed the supervised dataset built by
                              `build_dataset.py`

Examples are written the way operators actually speak: Devanagari Hindi,
romanised Hinglish and English, because the STT output for a Hindi speaker is
rarely pure Devanagari.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Domains decide *where* the answer comes from, which keeps the backend router
# small: telemetry -> live sensors, task -> schedule, safety -> safety service...
DOMAINS = ("telemetry", "diagnostic", "safety", "task", "training", "meta")


@dataclass(frozen=True)
class IntentSpec:
    name: str
    domain: str
    sensors: tuple[str, ...] = ()
    keywords: tuple[str, ...] = ()
    anti_keywords: tuple[str, ...] = ()
    examples: tuple[str, ...] = ()
    description: str = ""
    slots: tuple[str, ...] = ()


def _lines(block: str) -> tuple[str, ...]:
    return tuple(line.strip() for line in block.strip().splitlines() if line.strip())


_RAW: dict[str, dict] = {
    # ------------------------------------------------------------------ fuel
    "FUEL_STATUS": dict(
        domain="telemetry",
        sensors=("fuel_level_pct",),
        description="Remaining fuel in the tank and how long it will last.",
        keywords=("ईंधन", "इंधन", "डीज़ल", "डीजल", "फ्यूल", "टंकी", "तेल कितना",
                  "fuel", "diesel", "tank", "petrol"),
        anti_keywords=("हाइड्रोलिक", "hydraulic", "इंजन ऑयल", "engine oil"),
        examples="""
        कितना ईंधन बचा है
        ईंधन कितना है
        डीजल कितना बचा है
        फ्यूल लेवल क्या है
        टंकी में कितना तेल है
        क्या मुझे डीजल भरवाना पड़ेगा
        ईंधन खत्म तो नहीं हो रहा
        कितनी देर और चल जाएगी मशीन ईंधन में
        fuel kitna bacha hai
        diesel level kya hai
        kitna diesel hai machine me
        fuel bharwana padega kya
        how much fuel is left
        what is the fuel level
        do I need to refuel
        show me the diesel level
        """,
    ),
    "DEF_STATUS": dict(
        domain="telemetry",
        sensors=("def_level_pct",),
        description="Diesel exhaust fluid / AdBlue level.",
        keywords=("डीईएफ", "एडब्लू", "यूरिया", "def level", "adblue", "urea", "def"),
        examples="""
        डीईएफ कितना है
        एडब्लू लेवल बताओ
        यूरिया भरना है क्या
        def kitna bacha hai
        adblue level batao
        what is the def level
        do I need to top up adblue
        """,
    ),
    # ----------------------------------------------------------- temperatures
    "ENGINE_TEMP": dict(
        domain="telemetry",
        sensors=("engine_temp_c",),
        description="Engine coolant temperature.",
        keywords=("इंजन का तापमान", "इंजन तापमान", "इंजन गरम", "इंजन गर्म",
                  "engine temp", "engine temperature", "engine heat", "coolant"),
        anti_keywords=("हाइड्रोलिक", "hydraulic", "ट्रांसमिशन", "transmission"),
        examples="""
        इंजन का तापमान कितना है
        इंजन कितना गरम है
        क्या इंजन ज़्यादा गरम हो रहा है
        इंजन का टेम्परेचर बताओ
        कूलेंट का तापमान क्या है
        engine ka temperature kya hai
        engine garam to nahi ho raha
        engine temp batao
        what is the engine temperature
        is the engine overheating
        check coolant temperature
        """,
    ),
    "HYDRAULIC_TEMP": dict(
        domain="telemetry",
        sensors=("hydraulic_temp_c",),
        description="Hydraulic oil temperature (excavator).",
        keywords=("हाइड्रोलिक तापमान", "हाइड्रोलिक तेल", "हाइड्रोलिक गरम",
                  "hydraulic temp", "hydraulic oil", "hyd temp"),
        examples="""
        हाइड्रोलिक तेल का तापमान बताओ
        हाइड्रोलिक कितना गरम है
        हाइड्रोलिक ऑयल टेम्परेचर क्या है
        क्या हाइड्रोलिक ज़्यादा गरम है
        hydraulic oil ka temperature kya hai
        hydraulic temp batao
        what is the hydraulic oil temperature
        is the hydraulic system running hot
        """,
    ),
    "HYDRAULIC_PRESSURE": dict(
        domain="telemetry",
        sensors=("hydraulic_pressure_bar",),
        description="Hydraulic system pressure (excavator).",
        keywords=("हाइड्रोलिक दबाव", "हाइड्रोलिक प्रेशर", "hydraulic pressure", "hyd pressure"),
        examples="""
        हाइड्रोलिक दबाव कितना है
        हाइड्रोलिक प्रेशर बताओ
        क्या हाइड्रोलिक प्रेशर ठीक है
        hydraulic pressure kitna hai
        what is the hydraulic pressure
        is hydraulic pressure normal
        """,
    ),
    "TRANSMISSION_TEMP": dict(
        domain="telemetry",
        sensors=("transmission_temp_c",),
        description="Transmission oil temperature (loader, dozer).",
        keywords=("ट्रांसमिशन", "गियरबॉक्स", "transmission", "gearbox"),
        examples="""
        ट्रांसमिशन का तापमान कितना है
        गियरबॉक्स कितना गरम है
        ट्रांसमिशन टेम्परेचर बताओ
        transmission temperature kya hai
        transmission garam to nahi
        what is the transmission temperature
        """,
    ),
    # ------------------------------------------------------ machine condition
    "TIRE_PRESSURE": dict(
        domain="telemetry",
        sensors=("tire_pressure_psi",),
        description="Tyre pressure (loader).",
        keywords=("टायर", "पहिया", "tyre", "tire", "wheel pressure"),
        examples="""
        टायर का दबाव कितना है
        टायर प्रेशर ठीक है क्या
        पहियों में हवा कितनी है
        tyre pressure kya hai
        what is the tyre pressure
        are the tyres properly inflated
        """,
    ),
    "TRACK_TENSION": dict(
        domain="telemetry",
        sensors=("track_tension_pct",),
        description="Track / chain tension (excavator, dozer).",
        keywords=("ट्रैक", "चेन", "पटरी", "track tension", "chain tension"),
        examples="""
        ट्रैक टेंशन ठीक है क्या
        चेन कितनी ढीली है
        पटरी का टेंशन बताओ
        track tension kaisa hai
        is the track tension okay
        check the chain tension
        """,
    ),
    "UNDERCARRIAGE_WEAR": dict(
        domain="telemetry",
        sensors=("undercarriage_wear_pct",),
        description="Undercarriage wear percentage (dozer).",
        keywords=("अंडरकैरिज", "घिसाव", "undercarriage", "wear"),
        examples="""
        अंडरकैरिज कितना घिसा है
        अंडरकैरिज की हालत बताओ
        undercarriage wear kitna hai
        how worn is the undercarriage
        """,
    ),
    "OIL_PRESSURE": dict(
        domain="telemetry",
        sensors=("oil_pressure_kpa",),
        description="Engine oil pressure.",
        keywords=("ऑयल प्रेशर", "ऑयल दबाव", "तेल का दबाव", "इंजन ऑयल", "oil pressure", "engine oil"),
        examples="""
        इंजन ऑयल का दबाव कितना है
        ऑयल प्रेशर ठीक है क्या
        oil pressure kya hai
        what is the engine oil pressure
        """,
    ),
    "BATTERY_STATUS": dict(
        domain="telemetry",
        sensors=("battery_v",),
        description="Battery voltage / charging health.",
        keywords=("बैटरी", "चार्ज", "वोल्टेज", "battery", "voltage", "charging"),
        examples="""
        बैटरी कैसी है
        बैटरी का वोल्टेज बताओ
        बैटरी चार्ज है क्या
        battery voltage kya hai
        how is the battery
        is the battery charging properly
        """,
    ),
    "ENGINE_HOURS": dict(
        domain="telemetry",
        sensors=("engine_hours",),
        description="Total engine hour meter reading.",
        keywords=("इंजन घंटे", "घंटे मीटर", "कितने घंटे चली", "घंटे चल", "कुल घंटे", "घंटा मीटर",
                  "engine hours", "hour meter", "smu", "total hours"),
        anti_keywords=("आइडल", "idle", "सर्विस", "service"),
        examples="""
        इंजन कितने घंटे चला है
        घंटा मीटर कितना है
        मशीन के कुल घंटे बताओ
        engine hours kitne hue
        what is the engine hour reading
        total machine hours please
        """,
    ),
    "IDLE_TIME": dict(
        domain="telemetry",
        sensors=("idling_time_min",),
        description="Idling time today and the fuel it wasted.",
        keywords=("आइडल", "आइडलिंग", "खाली चल", "मशीन खाली", "बेकार चल", "बेकार",
                  "idle", "idling", "idle time"),
        examples="""
        आज कितनी देर मशीन खाली चली
        आइडल टाइम कितना है
        आइडलिंग ज़्यादा तो नहीं हो रही
        मशीन बेकार में कितनी देर चली
        idle time kitna hua aaj
        idling zyada ho rahi hai kya
        how much idle time today
        am I idling too much
        """,
    ),
    "LOAD_CYCLES": dict(
        domain="telemetry",
        sensors=("load_cycles",),
        description="Number of load / dig / push cycles completed today.",
        keywords=("साइकिल", "चक्कर", "बकेट भरे", "बकेट भर", "कितनी बकेट", "बाल्टी",
                  "cycles", "load cycles", "buckets", "bucket bhari"),
        examples="""
        आज कितने लोड साइकिल हुए
        कितने चक्कर लगाए आज
        कितनी बार बकेट भरी
        load cycles kitne hue
        how many load cycles today
        how many buckets have I done
        """,
    ),
    "PAYLOAD_STATUS": dict(
        domain="telemetry",
        sensors=("payload_kg", "bucket_payload_kg"),
        description="Current or average bucket payload weight.",
        keywords=("पेलोड", "वज़न", "वजन", "बकेट में कितना", "payload", "weight", "tonnage"),
        examples="""
        बकेट में कितना वज़न है
        पेलोड कितना है
        औसत लोड कितना रहा
        क्या ट्रक ओवरलोड है
        payload kitna hai
        bucket ka weight batao
        what is the current payload
        is the truck overloaded
        """,
    ),
    "PRODUCTIVITY": dict(
        domain="diagnostic",
        sensors=("load_cycles", "idling_time_min", "fuel_used_l"),
        description="How the operator is performing against the shift target.",
        keywords=("उत्पादकता", "परफॉर्मेंस", "प्रदर्शन", "कितना अच्छा", "टारगेट", "ठीक काम",
                  "अच्छा काम", "काम कर रहा", "productivity", "performance", "target",
                  "efficiency", "doing well", "kaam kaisa"),
        examples="""
        मेरा आज का प्रदर्शन कैसा है
        क्या मैं टारगेट पर हूँ
        उत्पादकता कैसी चल रही है
        मैं कितना अच्छा काम कर रहा हूँ
        aaj ka performance kaisa hai
        target pura ho raha hai kya
        how is my productivity today
        am I on target for the shift
        """,
    ),
    # ------------------------------------------------------------ diagnostics
    "MACHINE_HEALTH": dict(
        domain="diagnostic",
        sensors=(),
        description="Overall machine health roll-up across every sensor.",
        keywords=("मशीन ठीक", "मशीन की हालत", "सब ठीक", "सब कुछ ठीक", "कोई खराबी", "कोई दिक्कत",
                  "कुछ गड़बड़", "कोई समस्या", "सब सही",
                  "machine ok", "everything fine", "any problem", "health", "sab theek",
                  "sab kuch theek", "koi problem", "anything broken", "anything wrong",
                  "something wrong", "broken"),
        examples="""
        मशीन में कोई खराबी है क्या
        मशीन ठीक चल रही है
        सब कुछ ठीक है ना
        कोई दिक्कत तो नहीं है
        मशीन की हालत कैसी है
        machine me koi problem hai kya
        sab theek hai na
        machine ki condition kaisi hai
        is there anything wrong with the machine
        is the machine healthy
        give me a machine health check
        """,
    ),
    "ANOMALY_STATUS": dict(
        domain="diagnostic",
        sensors=(),
        description="Unusual usage patterns detected from recent telemetry.",
        keywords=("असामान्य", "अजीब", "गड़बड़ी", "पैटर्न", "unusual", "abnormal", "anomaly", "strange"),
        examples="""
        कुछ असामान्य दिख रहा है क्या
        मशीन के इस्तेमाल में कोई गड़बड़ी है
        कोई अजीब पैटर्न मिला क्या
        koi unusual cheez mili kya
        any unusual behaviour detected
        show me anomalies in machine usage
        """,
    ),
    "ACTIVE_ALERTS": dict(
        domain="diagnostic",
        sensors=(),
        description="Currently active fault codes and warnings.",
        keywords=("अलर्ट", "चेतावनी", "वार्निंग", "लाल बत्ती", "एरर", "फॉल्ट",
                  "alert", "warning", "error", "fault", "code"),
        examples="""
        कोई अलर्ट है क्या
        कितनी चेतावनियाँ चल रही हैं
        डैशबोर्ड पर लाल बत्ती क्यों जल रही है
        एरर कोड बताओ
        koi alert aaya hai kya
        warning kyun aa rahi hai
        what alerts are active
        read out the fault codes
        """,
    ),
    "MAINTENANCE_DUE": dict(
        domain="diagnostic",
        sensors=("engine_hours",),
        description="Hours remaining until the next scheduled service.",
        keywords=("सर्विस", "मेंटेनेंस", "रखरखाव", "सर्विसिंग", "service", "maintenance", "servicing"),
        examples="""
        सर्विस कब होनी है
        अगली सर्विस में कितने घंटे बचे हैं
        मेंटेनेंस ड्यू है क्या
        service kab due hai
        when is the next service
        how many hours until maintenance
        """,
    ),
    # ----------------------------------------------------------------- safety
    "SAFETY_STATUS": dict(
        domain="safety",
        sensors=("seatbelt", "proximity_objects"),
        description="Overall safety state: belt, proximity, violations today.",
        keywords=("सुरक्षा", "सुरक्षित", "सेफ्टी", "safety", "safe to operate", "safety status"),
        anti_keywords=("सीट बेल्ट", "seatbelt", "seat belt", "आसपास", "पीछे", "swing", "proximity"),
        examples="""
        सुरक्षा की स्थिति क्या है
        क्या सब सुरक्षित है
        सेफ्टी स्टेटस बताओ
        आज कोई सुरक्षा उल्लंघन हुआ
        safety status kya hai
        sab kuch safe hai kya
        what is my safety status
        any safety violations today
        """,
    ),
    "SEATBELT_STATUS": dict(
        domain="safety",
        sensors=("seatbelt",),
        description="Seatbelt fastened or not, and compliance today.",
        keywords=("सीट बेल्ट", "बेल्ट", "पट्टा", "seatbelt", "seat belt", "belt"),
        examples="""
        सीट बेल्ट लगी है क्या
        क्या मेरी बेल्ट बंधी है
        सीट बेल्ट का स्टेटस बताओ
        seatbelt laga hai kya
        is my seatbelt fastened
        seat belt compliance today
        """,
    ),
    "PROXIMITY_HAZARD": dict(
        domain="safety",
        sensors=("proximity_objects",),
        description="People or objects inside the machine's danger zone.",
        keywords=("आसपास", "नज़दीक", "पास में कोई", "पीछे कोई", "कोई आदमी", "कोई व्यक्ति",
                  "टकरा", "खतरा", "दूरी", "proximity", "nearby", "around me", "blind spot",
                  "hazard", "anyone near", "safe to swing", "swing safely", "behind me"),
        examples="""
        क्या आसपास कोई है
        मशीन के पास कोई व्यक्ति है क्या
        पीछे कोई खतरा तो नहीं
        क्या मैं सुरक्षित रूप से घूम सकता हूँ
        aas paas koi hai kya
        peeche koi hai kya
        is anyone near the machine
        any proximity hazard right now
        can I swing safely
        """,
    ),
    "REPORT_INCIDENT": dict(
        domain="safety",
        sensors=(),
        description="Operator wants to log an incident or near miss.",
        keywords=("रिपोर्ट", "दुर्घटना", "हादसा", "शिकायत", "घटना दर्ज",
                  "report incident", "near miss", "accident", "log incident"),
        examples="""
        मुझे एक घटना दर्ज करनी है
        दुर्घटना की रिपोर्ट करनी है
        एक नियर मिस हुआ है
        शिकायत दर्ज करो
        incident report karna hai
        near miss hua hai report karo
        I want to report an incident
        log a near miss please
        """,
    ),
    # ------------------------------------------------------------------ tasks
    "TASK_TODAY": dict(
        domain="task",
        sensors=(),
        description="Today's assigned work.",
        keywords=("आज का काम", "मेरा काम", "क्या करना है", "काम क्या है", "ड्यूटी", "आज की ड्यूटी",
                  "today's task", "my task", "what should i do", "assignment", "duty",
                  "aaj ka kaam", "aaj ki duty"),
        anti_keywords=("कितना समय", "how long", "अगला", "next"),
        examples="""
        आज का मेरा काम क्या है
        मुझे आज क्या करना है
        आज की ड्यूटी बताओ
        मेरा अगला काम नहीं आज का पूरा काम बताओ
        aaj ka kaam kya hai
        mujhe aaj kya karna hai
        what is my task today
        read out today's assignment
        what work is assigned to me
        """,
    ),
    "TASK_NEXT": dict(
        domain="task",
        sensors=(),
        description="The next task in the queue.",
        keywords=("अगला काम", "आगे क्या", "इसके बाद", "अगला", "बाद में क्या",
                  "next task", "after this", "what's next", "comes next", "next job",
                  "agla kaam", "next kaam"),
        examples="""
        अगला काम क्या है
        इसके बाद क्या करना है
        आगे क्या काम है
        agla kaam kya hai
        iske baad kya karna hai
        what is my next task
        what comes after this job
        """,
    ),
    "TASK_TIME_ESTIMATE": dict(
        domain="task",
        sensors=(),
        description="Predicted time to finish the current task.",
        keywords=("कितना समय", "कितनी देर", "कब तक", "कितने घंटे लगेंगे", "समय लगेगा", "देर लगेगी",
                  "खत्म होने में", "कितनी देर है",
                  "how long", "how much time", "eta", "finish by", "time estimate",
                  "when will", "kitni der", "kitna time", "der lagegi", "time lagega"),
        anti_keywords=("आइडल", "idle", "खाली", "बेकार"),
        examples="""
        यह काम पूरा होने में कितना समय लगेगा
        कितनी देर लगेगी
        कब तक खत्म हो जाएगा
        इस काम में कितने घंटे लगेंगे
        kitna time lagega ye kaam
        kab tak khatam hoga
        how long will this task take
        what is the estimated time to finish
        when will I be done with this
        """,
    ),
    "TASK_PROGRESS": dict(
        domain="task",
        sensors=("load_cycles",),
        description="How much of the current task is done.",
        keywords=("कितना हो गया", "प्रगति", "कितना बाकी", "पूरा हुआ", "कितना काम", "कितना निपटा",
                  "progress", "how much done", "how much left", "kitna ho gaya"),
        examples="""
        काम कितना हो गया है
        कितना बाकी है
        मेरी प्रगति बताओ
        kitna kaam ho gaya
        kitna bacha hai
        how much of the task is done
        show my progress
        """,
    ),
    "SHIFT_SUMMARY": dict(
        domain="task",
        sensors=("load_cycles", "idling_time_min", "fuel_used_l", "engine_hours"),
        description="End of shift roll-up.",
        keywords=("शिफ्ट", "सारांश", "आज का हिसाब", "पूरे दिन", "रिपोर्ट दो",
                  "shift summary", "summary", "recap", "day report"),
        examples="""
        आज की शिफ्ट का सारांश बताओ
        पूरे दिन का हिसाब दो
        शिफ्ट रिपोर्ट सुनाओ
        aaj ki shift ka summary do
        give me the shift summary
        recap my day
        """,
    ),
    # --------------------------------------------------------------- training
    "TRAINING_HELP": dict(
        domain="training",
        sensors=(),
        description="Operator wants training material or an instructor.",
        keywords=("ट्रेनिंग", "प्रशिक्षण", "सीखना", "वीडियो", "सिखाओ", "कोर्स", "इंस्ट्रक्टर",
                  "training", "learn", "tutorial", "course", "instructor", "video"),
        examples="""
        मुझे ट्रेनिंग चाहिए
        कोई सीखने वाला वीडियो दिखाओ
        प्रशिक्षण कहाँ मिलेगा
        इंस्ट्रक्टर से बात करनी है
        training video dikhao
        mujhe sikhna hai
        I need training on this machine
        book an instructor session
        """,
    ),
    "HOW_TO_OPERATE": dict(
        domain="training",
        sensors=(),
        description="A how-do-I question about operating the machine.",
        keywords=("कैसे करूँ", "कैसे चलाऊँ", "कैसे उठाऊँ", "तरीका", "how do i", "how to", "procedure"),
        examples="""
        खाई कैसे खोदूँ
        ट्रक में सही तरीके से कैसे लोड करूँ
        बकेट को कैसे भरना चाहिए
        मशीन शुरू करने का सही तरीका क्या है
        trench kaise khodu
        truck me load kaise karu
        how do I load a truck properly
        what is the correct starting procedure
        """,
    ),
    # ------------------------------------------------------------------- meta
    "WEATHER_CONDITIONS": dict(
        domain="meta",
        sensors=("ambient_temp_c",),
        description="Site weather and how it affects the work.",
        keywords=("मौसम", "गर्मी", "गरमी", "बारिश", "तापमान बाहर", "बाहर कितनी", "बाहर का",
                  "weather", "rain", "hot outside", "mausam"),
        examples="""
        आज मौसम कैसा है
        बारिश होगी क्या
        बाहर कितनी गर्मी है
        mausam kaisa hai aaj
        will it rain today
        what is the weather on site
        """,
    ),
    "SWITCH_MACHINE": dict(
        domain="meta",
        sensors=(),
        slots=("machine",),
        description="Select or change the active machine.",
        keywords=("मशीन बदल", "दूसरी मशीन", "एक्सकेवेटर चुन", "लोडर चुन", "डोज़र चुन",
                  "switch machine", "change machine", "select excavator", "select loader"),
        examples="""
        मशीन बदलनी है
        दूसरी मशीन चुनो
        मुझे लोडर चाहिए
        एक्सकेवेटर चुनो
        कैट 320 चुनो
        डोज़र पर जाओ
        machine change karo
        loader select karo
        switch to the excavator
        change to CAT 950 loader
        """,
    ),
    "GREETING": dict(
        domain="meta",
        sensors=(),
        description="Greeting or small talk.",
        keywords=("नमस्ते", "नमस्कार", "हैलो", "सुप्रभात", "राम राम", "hello", "hi ", "good morning"),
        examples="""
        नमस्ते
        नमस्कार सहायक
        राम राम
        सुप्रभात
        हैलो
        namaste
        hello sahayak
        good morning
        """,
    ),
    "HELP": dict(
        domain="meta",
        sensors=(),
        description="What can this assistant do.",
        keywords=("मदद", "क्या पूछ सकता", "क्या कर सकते हो", "किन चीज़ों", "क्या क्या कर",
                  "help", "what can you do", "options", "kya kar sakte", "madad"),
        examples="""
        तुम क्या कर सकते हो
        मैं तुमसे क्या पूछ सकता हूँ
        मदद चाहिए
        kya kar sakte ho tum
        what can you do
        what can I ask you
        help me
        """,
    ),
}

UNKNOWN = "UNKNOWN"


def _build() -> dict[str, IntentSpec]:
    out: dict[str, IntentSpec] = {}
    for name, raw in _RAW.items():
        out[name] = IntentSpec(
            name=name,
            domain=raw["domain"],
            sensors=tuple(raw.get("sensors", ())),
            keywords=tuple(raw.get("keywords", ())),
            anti_keywords=tuple(raw.get("anti_keywords", ())),
            examples=_lines(raw.get("examples", "")),
            description=raw.get("description", ""),
            slots=tuple(raw.get("slots", ())),
        )
    return out


INTENTS: dict[str, IntentSpec] = _build()
INTENT_NAMES: list[str] = sorted(INTENTS)
LABELS: list[str] = INTENT_NAMES + [UNKNOWN]


def get(name: str) -> IntentSpec | None:
    return INTENTS.get(name)


def domain_of(name: str) -> str:
    spec = INTENTS.get(name)
    return spec.domain if spec else "meta"


def stats() -> dict:
    return {
        "intents": len(INTENTS),
        "examples": sum(len(s.examples) for s in INTENTS.values()),
        "domains": {d: sum(1 for s in INTENTS.values() if s.domain == d) for d in DOMAINS},
    }


if __name__ == "__main__":
    import json

    print(json.dumps(stats(), indent=2))
