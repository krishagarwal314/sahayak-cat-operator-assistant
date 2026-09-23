"""Make text speakable by a Hindi TTS model.

MMS-TTS Hindi is trained on Devanagari text only. Anything else in the input -
Arabic digits, Latin letters, machine IDs, unit symbols - is either skipped,
mumbled, or read letter by garbled letter. That is why replies like "CAT 320
पर ईंधन 18.4% है" came out wrong: the model never saw "CAT", "320", "18.4" or
"%" during training.

This module rewrites a reply into pure spoken Devanagari before synthesis:

    "CAT 320 पर ईंधन 18.4% है"
 -> "कैट तीन सौ बीस पर, ईंधन अठारह दशमलव चार प्रतिशत है।"

It also inserts pauses so the voice is slower and easier to follow, which
matters for listeners who rely on audio rather than reading.

Why this is necessary rather than cosmetic - the MMS-TTS Hindi vocabulary is
72 symbols, and it is missing far more than you would guess:

  * digits 5, 6, 7 and 9 are absent (only 0 1 2 3 4 8 exist), so "56 psi"
    was read as two blanks and a dropped word
  * there are no Latin letters at all, so "CAT" and "EXC001" vanished
  * there is no punctuation, so "।" and "," never produced a pause
  * precomposed nukta letters (U+0958..095F, e.g. "ज़") are absent; only the
    base letter followed by a separate nukta sign is in vocabulary

Anything outside the vocabulary is silently deleted by the tokenizer. So we
convert every number to words, transliterate every Latin token, decompose
nukta letters, and create pauses with real silence between phrases instead
of relying on punctuation the model cannot see.
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------- numbers
_ONES = [
    "शून्य", "एक", "दो", "तीन", "चार", "पांच", "छह", "सात", "आठ", "नौ",
    "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
    "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस",
    "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
    "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चौवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास",
    "पचास", "इक्यावन", "बावन", "तिरेपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ",
    "साठ", "इकसठ", "बासठ", "तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर",
    "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्यासी",
    "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी",
    "नब्बे", "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
]


def int_to_hindi(n: int) -> str:
    """0 .. 99,99,999 in Indian place value (हज़ार, लाख)."""
    if n < 0:
        return "माइनस " + int_to_hindi(-n)
    if n < 100:
        return _ONES[n]
    parts: list[str] = []
    lakh, n = divmod(n, 100000)
    thousand, n = divmod(n, 1000)
    hundred, rest = divmod(n, 100)
    if lakh:
        parts.append(f"{int_to_hindi(lakh)} लाख")
    if thousand:
        parts.append(f"{_ONES[thousand] if thousand < 100 else int_to_hindi(thousand)} हज़ार")
    if hundred:
        parts.append(f"{_ONES[hundred]} सौ")
    if rest:
        parts.append(_ONES[rest])
    return " ".join(parts)


def number_to_hindi(token: str) -> str:
    """'18.4' -> 'अठारह दशमलव चार', '07:30' -> 'सात बजकर तीस मिनट'."""
    token = token.replace(",", "")
    if ":" in token:
        h, _, m = token.partition(":")
        if h.isdigit() and m.isdigit():
            hours, minutes = int(h), int(m)
            if minutes == 0:
                return f"{int_to_hindi(hours)} बजे"
            return f"{int_to_hindi(hours)} बजकर {int_to_hindi(minutes)} मिनट"
    if "." in token:
        whole, _, frac = token.partition(".")
        frac = frac.rstrip("0")
        head = int_to_hindi(int(whole or 0))
        if not frac:
            return head
        # Read decimals digit by digit, as people say them aloud.
        return f"{head} दशमलव " + " ".join(_ONES[int(d)] for d in frac[:2])
    return int_to_hindi(int(token))


# ---------------------------------------------------------------- latin words
# Words that routinely appear inside Hindi replies and must be pronounced as
# the operator would say them, not spelled out.
_TERMS = {
    "cat": "कैट", "gc": "जी सी", "def": "डी ई एफ", "adblue": "एडब्लू",
    "psi": "पी एस आई", "kpa": "किलो पास्कल", "bar": "बार", "kg": "किलो",
    "km": "किलोमीटर", "min": "मिनट", "hrs": "घंटे", "hr": "घंटा", "h": "घंटे",
    "rpm": "आर पी एम", "ok": "ओके", "gps": "जी पी एस", "id": "आई डी",
    "pit": "पिट", "bay": "बे", "grid": "ग्रिड", "section": "सेक्शन",
    "yard": "यार्ड", "north": "नॉर्थ", "bench": "बेंच", "ramp": "रैंप",
    "stockpile": "स्टॉकपाइल", "crusher": "क्रशर", "road": "रोड", "haul": "हॉल",
    "excavator": "एक्सकेवेटर", "loader": "लोडर", "dozer": "डोज़र",
    "fuel": "फ्यूल", "engine": "इंजन", "hydraulic": "हाइड्रोलिक",
    "seatbelt": "सीट बेल्ट", "day": "डे", "access": "एक्सेस", "feed": "फीड",
}

# Letter names, for IDs and acronyms nobody pronounces as a word.
_LETTERS = {
    "a": "ए", "b": "बी", "c": "सी", "d": "डी", "e": "ई", "f": "एफ", "g": "जी",
    "h": "एच", "i": "आई", "j": "जे", "k": "के", "l": "एल", "m": "एम", "n": "एन",
    "o": "ओ", "p": "पी", "q": "क्यू", "r": "आर", "s": "एस", "t": "टी", "u": "यू",
    "v": "वी", "w": "डब्ल्यू", "x": "एक्स", "y": "वाई", "z": "ज़ेड",
}

_SYMBOLS = {
    "%": " प्रतिशत", "°C": " डिग्री", "°": " डिग्री", "₹": "रुपये ",
    "&": " और ", "+": " प्लस ", "/": " ", "×": " गुणा ",
    # A colon introduces what follows ("सबसे ज़रूरी: ...") - speak it as a pause.
    # The Arabic comma is a common mistype for a Hindi list separator.
    ": ": ", ", "،": ",",
}


def _latin_word(word: str) -> str:
    low = word.lower()
    if low in _TERMS:
        return _TERMS[low]
    # Machine IDs like EXC001: letters spelled, digits read as a number.
    match = re.fullmatch(r"([a-z]+)(\d+)", low)
    if match:
        letters, digits = match.groups()
        spelled = _TERMS.get(letters) or " ".join(_LETTERS.get(c, "") for c in letters)
        return f"{spelled} {number_to_hindi(digits)}"
    if len(low) <= 4 or word.isupper():
        return " ".join(_LETTERS.get(c, "") for c in low)
    # Longer unknown English word: spell it rather than drop it silently.
    return " ".join(_LETTERS.get(c, "") for c in low)


# The exact character set of facebook/mms-tts-hin. Used to verify that
# everything we hand the model is something it can actually pronounce.
MMS_HIN_VOCAB = set(
    " '-012348_`ँंःअआइईउऊएऐऑओऔकखगघचछजझञटठडढणतथदधनपफबभमयरलवशषसह़ािीुूृॅेैॉोौ्\u200d"
)

# Precomposed nukta letters -> base letter + nukta sign, which is in vocab.
_NUKTA_DECOMPOSE = {
    "\u0958": "\u0915\u093c", "\u0959": "\u0916\u093c", "\u095a": "\u0917\u093c",
    "\u095b": "\u091c\u093c", "\u095c": "\u0921\u093c", "\u095d": "\u0922\u093c",
    "\u095e": "\u092b\u093c", "\u095f": "\u092f\u093c",
}
# Rare letters outside the vocabulary, mapped to their nearest spoken form.
_RARE = {"ऋ": "रि", "ॠ": "री", "ऌ": "लि", "ऍ": "ऐ", "ऎ": "ए", "ऒ": "ओ", "ॐ": "ओम"}


def unspeakable(text: str) -> set[str]:
    """Characters MMS-TTS Hindi would silently drop. Empty set means all good."""
    return {ch for ch in text if ch not in MMS_HIN_VOCAB and ch not in "।,?!.;"}


# ---------------------------------------------------------------- pipeline
_NUM = re.compile(r"\d+(?:[.,:]\d+)*")
_LATIN = re.compile(r"[A-Za-z]+\d*")
_DASH = re.compile(r"\s*[-–—]\s*")
_WS = re.compile(r"\s+")


def to_speech(text: str, *, slow: bool = False) -> str:
    """Rewrite a Hindi reply so a Devanagari-only TTS model can read all of it."""
    if not text:
        return ""
    out = text

    # Symbols first, so "18.4%" becomes "18.4 प्रतिशत" before numbers are read.
    for symbol, spoken in _SYMBOLS.items():
        out = out.replace(symbol, spoken)

    # A dash between two parts of a place name is a pause, not a minus sign.
    out = _DASH.sub(", ", out)

    out = _LATIN.sub(lambda m: " " + _latin_word(m.group(0)) + " ", out)

    def speak_number(match: re.Match) -> str:
        token = match.group(0)
        # A listener cannot hold "seventy five point four" in their head while
        # also driving a machine. In slow mode, whole numbers above ten are
        # rounded; small quantities keep one decimal because 4.6 litres and 5
        # litres are genuinely different answers.
        if slow and "." in token and ":" not in token:
            try:
                value = float(token.replace(",", ""))
                token = str(round(value)) if abs(value) >= 10 else f"{value:.1f}"
            except ValueError:
                pass
        return " " + number_to_hindi(token) + " "

    out = _NUM.sub(speak_number, out)
    # "07:30 बजे" would otherwise become "सात बजकर तीस मिनट बजे".
    out = re.sub(r"(मिनट|बजे)\s+बजे", r"\1", out)

    # Quotes and brackets carry no sound.
    out = re.sub(r"[\"'“”‘’()\[\]{}*_#|<>]", " ", out)
    out = _WS.sub(" ", out).strip()

    for composed, decomposed in _NUKTA_DECOMPOSE.items():
        out = out.replace(composed, decomposed)
    for rare, spoken in _RARE.items():
        out = out.replace(rare, spoken)
    # The model has no digit 5, 6, 7 or 9. Any digit that survived to here would
    # be dropped, so read stragglers one by one rather than lose them.
    out = re.sub(r"\d", lambda m: " " + _ONES[int(m.group(0))] + " ", out)
    out = _WS.sub(" ", out).strip()

    if out and out[-1] not in "।?!.":
        out += "।"
    return out.replace(" ,", ",").replace(" ।", "।")


def split_sentences(text: str) -> list[str]:
    """Split on sentence ends so long replies can be synthesised in chunks."""
    parts = re.split(r"(?<=[।?!.])\s+", text.strip())
    return [p for p in (s.strip() for s in parts) if p]


def phrases(text: str) -> list[tuple[str, str]]:
    """Split into (phrase, pause) pairs, pause being 'short' or 'long'.

    The model cannot see punctuation, so a comma produces no pause at all. We
    synthesise each phrase separately and put real silence between them:
    short after a comma, long after a sentence end.
    """
    out: list[tuple[str, str]] = []
    for sentence in split_sentences(text):
        pieces = [p.strip() for p in re.split(r"[,;]", sentence) if p.strip()]
        for index, piece in enumerate(pieces):
            clean = piece.strip(" ।?!.")
            if clean:
                out.append((clean, "long" if index == len(pieces) - 1 else "short"))
    return out
