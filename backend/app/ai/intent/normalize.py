"""Text normalisation for operator utterances.

STT output from a noisy cab is messy: Devanagari digits, English numerals spoken
in Hindi, filler words, inconsistent nukta/matra forms, and a constant drift
between Devanagari and romanised Hinglish. Everything downstream (rules,
embeddings, classifier) sees the output of this module, so the same sentence
typed or spoken lands on the same representation.
"""

from __future__ import annotations

import re
import unicodedata

# --------------------------------------------------------------------------
# character level
# --------------------------------------------------------------------------
_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")

# Nukta variants that Hindi keyboards and STT systems disagree on.
_NUKTA_FOLD = {
    "ऩ": "न",  # ऩ -> न
    "ऱ": "र",  # ऱ -> र
    "ऴ": "ळ",  # ऴ -> ळ
    "क़": "क",  # क़ -> क
    "ख़": "ख",  # ख़ -> ख
    "ग़": "ग",  # ग़ -> ग
    "ज़": "ज",  # ज़ -> ज
    "ड़": "ड",  # ड़ -> ड
    "ढ़": "ढ",  # ढ़ -> ढ
    "फ़": "फ",  # फ़ -> फ
    "य़": "य",  # य़ -> य
}
_NUKTA_TABLE = str.maketrans(_NUKTA_FOLD)

# Filler / politeness tokens that carry no intent signal.
_FILLERS = {
    "अच्छा", "तो", "जी", "हाँ", "हां", "अरे", "यार", "भाई", "please", "plz",
    "kripya", "कृपया", "ज़रा", "जरा", "um", "uh", "hmm", "एक", "बस",
    "bhai", "yaar", "ji", "arre", "acha", "achha", "haan", "han", "toh",
}

# Number words -> digits (Hindi + romanised), enough for cab-sized numbers.
_NUMBER_WORDS = {
    "शून्य": "0", "एक": "1", "दो": "2", "तीन": "3", "चार": "4", "पाँच": "5",
    "पांच": "5", "छह": "6", "छः": "6", "सात": "7", "आठ": "8", "नौ": "9",
    "दस": "10", "बीस": "20", "तीस": "30", "चालीस": "40", "पचास": "50", "सौ": "100",
    "ek": "1", "teen": "3", "paanch": "5", "panch": "5",
    "chah": "6", "saat": "7", "aath": "8", "nau": "9", "das": "10",
}

# Frequent STT confusions on machine vocabulary, observed with Whisper on Hindi
# audio recorded in a noisy cab.
_ASR_FIXES = {
    "ई धन": "ईंधन", "इ धन": "ईंधन", "इंधन": "ईंधन", "ईधन": "ईंधन",
    "फ्युल": "फ्यूल", "फ़्यूल": "फ्यूल",
    "डीसल": "डीजल", "डीज़ल": "डीजल", "डिजल": "डीजल",
    "हाइड्रोलिक": "हाइड्रोलिक", "हायड्रोलिक": "हाइड्रोलिक", "हाइड्रॉलिक": "हाइड्रोलिक",
    "इंजिन": "इंजन", "इन्जन": "इंजन",
    "सीटबेल्ट": "सीट बेल्ट", "सीट-बेल्ट": "सीट बेल्ट",
    "एक्स्कवेटर": "एक्सकेवेटर", "एक्सावेटर": "एक्सकेवेटर", "एस्कवेटर": "एक्सकेवेटर",
    "लोडर": "लोडर", "लोडार": "लोडर",
    "डोजर": "डोज़र", "डोझर": "डोज़र",
    "टेंपरेचर": "टेम्परेचर", "तापमन": "तापमान",
    "मशिन": "मशीन", "मसीन": "मशीन",
    "गर्म": "गरम", "गरमी": "गरम", "ग़रम": "गरम",
    "बॅटरी": "बैटरी", "प्रेशर": "दबाव", "टेम्परेचर": "तापमान", "टेम्प्रेचर": "तापमान",
    "excavater": "excavator", "exavator": "excavator", "loder": "loader",
    "hydrolic": "hydraulic", "hydralic": "hydraulic",
}

_PUNCT = re.compile(r"[^\wऀ-ॿ\s%°.]+", re.UNICODE)
_WS = re.compile(r"\s+")


def strip_accents_ascii(text: str) -> str:
    """Fold Latin accents only; Devanagari is left untouched."""
    out = []
    for ch in unicodedata.normalize("NFD", text):
        if unicodedata.combining(ch) and ord(ch) < 0x0300 + 0x80:
            continue
        out.append(ch)
    return unicodedata.normalize("NFC", "".join(out))


def devanagari_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    deva = sum(1 for c in letters if "ऀ" <= c <= "ॿ")
    return deva / len(letters)


def detect_script(text: str) -> str:
    """'deva' | 'latin' | 'mixed' - used to pick the right response language."""
    ratio = devanagari_ratio(text)
    if ratio > 0.75:
        return "deva"
    if ratio < 0.15:
        return "latin"
    return "mixed"


def normalize(text: str, *, drop_fillers: bool = True) -> str:
    """Canonical form used by every downstream intent stage."""
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = text.translate(_DEVANAGARI_DIGITS).translate(_NUKTA_TABLE)
    text = text.lower()

    for wrong, right in _ASR_FIXES.items():
        if wrong in text:
            text = text.replace(wrong, right)

    text = _PUNCT.sub(" ", text)
    text = _WS.sub(" ", text).strip()

    tokens = text.split()
    cleaned: list[str] = []
    for tok in tokens:
        if tok in _NUMBER_WORDS:
            cleaned.append(_NUMBER_WORDS[tok])
            continue
        if drop_fillers and tok in _FILLERS and len(tokens) > 2:
            continue
        cleaned.append(tok)
    return " ".join(cleaned)


def tokens(text: str) -> list[str]:
    return normalize(text).split()


def extract_numbers(text: str) -> list[float]:
    return [float(m) for m in re.findall(r"\d+(?:\.\d+)?", normalize(text))]


# --------------------------------------------------------------------------
# machine name resolution (slot filling for SWITCH_MACHINE)
# --------------------------------------------------------------------------
_MACHINE_ALIASES: dict[str, tuple[str, ...]] = {
    "excavator": ("एक्सकेवेटर", "खुदाई", "जेसीबी", "पोकलेन", "320", "excavator", "digger", "poclain", "exc"),
    "loader": ("लोडर", "950", "loader", "wheel loader", "ldr"),
    "dozer": ("डोज़र", "डोजर", "बुलडोजर", "बुलडोज़र", "d6", "dozer", "bulldozer", "dzr"),
}


def match_machine_family(text: str) -> str | None:
    """Return 'excavator' | 'loader' | 'dozer' if the utterance names one."""
    norm = normalize(text)
    best: tuple[int, str] | None = None
    for family, aliases in _MACHINE_ALIASES.items():
        for alias in aliases:
            if alias in norm:
                score = len(alias)
                if best is None or score > best[0]:
                    best = (score, family)
    return best[1] if best else None
