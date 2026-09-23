"""Face login.

Many operators struggle with the login itself: typing an ID and a password on a
phone, with gloves on, is exactly the kind of barrier this product exists to
remove. So identity is established by looking at the camera.

Two small OpenCV Zoo models, both run on CPU in milliseconds:

  YuNet  (228 KB)  face detector - finds the face and five landmarks
  SFace  (37 MB)   face recogniser - aligns the face and turns it into a
                   128-dimensional identity vector

An operator is enrolled by capturing a few frames of their face once. Login
compares the live face to every enrolled vector by cosine similarity. We only
accept a match that is both above the recogniser's published threshold and
clearly ahead of the next closest person, so two similar looking operators
cannot be confused for each other.

Enrolled vectors live in backend/data/faces.json. Only these numeric vectors
are stored - never the photograph itself.
"""

from __future__ import annotations

import json
import logging
import threading
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from ..config import BACKEND_DIR, settings
from . import registry

log = logging.getLogger("saathi.face")

_KEY = "face"
MODEL_DIR = BACKEND_DIR / "models" / "face"
STORE = BACKEND_DIR / "data" / "faces.json"

_ZOO = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models"
MODELS = {
    "detector": ("face_detection_yunet_2023mar.onnx", f"{_ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx"),
    "recognizer": ("face_recognition_sface_2021dec.onnx", f"{_ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx"),
}

# SFace's published cosine threshold for "same person" is 0.363. We ask for a
# little more, plus a clear lead over the runner-up.
MATCH_THRESHOLD = settings.face_match_threshold
MATCH_MARGIN = 0.06
MAX_SAMPLES = 5
MIN_FACE_PX = 70

_LOCK = threading.Lock()


@dataclass
class FaceResult:
    status: str                       # match | unknown | no_face | too_small | unavailable
    operator_id: str | None = None
    score: float = 0.0
    runner_up: float = 0.0
    box: list[float] = field(default_factory=list)   # x, y, w, h as fractions of the frame
    message_hi: str = ""
    message_en: str = ""

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "operator_id": self.operator_id,
            "score": round(self.score, 3),
            "runner_up": round(self.runner_up, 3),
            "box": [round(v, 4) for v in self.box],
            "message": {"hi": self.message_hi, "en": self.message_en},
        }


# ---------------------------------------------------------------- models
def ensure_models() -> bool:
    """Download the two model files if they are missing. Returns True if present."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in MODELS.values():
        path = MODEL_DIR / name
        if path.exists() and path.stat().st_size > 1000:
            continue
        log.info("downloading %s", name)
        try:
            tmp = path.with_suffix(".part")
            urllib.request.urlretrieve(url, tmp)
            tmp.rename(path)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not download %s: %s", name, exc)
            return False
    return True


def _load():
    import cv2

    if not ensure_models():
        raise RuntimeError("face models unavailable")
    detector = cv2.FaceDetectorYN.create(
        str(MODEL_DIR / MODELS["detector"][0]), "", (320, 320),
        score_threshold=0.75, nms_threshold=0.3, top_k=10,
    )
    recognizer = cv2.FaceRecognizerSF.create(str(MODEL_DIR / MODELS["recognizer"][0]), "")
    return {"cv2": cv2, "detector": detector, "recognizer": recognizer}


def available() -> bool:
    if not settings.enable_face:
        return False
    return registry.get(_KEY, _load) is not None


# ---------------------------------------------------------------- store
def _read_store() -> dict[str, list[list[float]]]:
    if not STORE.exists():
        return {}
    try:
        return json.loads(STORE.read_text())
    except Exception:  # noqa: BLE001 - a corrupt store should not block login
        return {}


def _write_store(data: dict) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.replace(STORE)


def enrolled() -> dict[str, int]:
    """operator_id -> number of face samples on file."""
    return {op: len(vectors) for op, vectors in _read_store().items() if vectors}


def forget(operator_id: str) -> None:
    with _LOCK:
        data = _read_store()
        data.pop(operator_id, None)
        _write_store(data)


# ---------------------------------------------------------------- pipeline
def _decode(raw: bytes):
    import numpy as np

    bundle = registry.get(_KEY, _load)
    cv2 = bundle["cv2"]
    image = cv2.imdecode(np.frombuffer(raw, dtype="uint8"), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("could not decode image")
    # Phone cameras send large frames; recognition needs nowhere near that.
    height, width = image.shape[:2]
    if width > 640:
        scale = 640 / width
        image = cv2.resize(image, (640, int(height * scale)))
    return image


def _largest_face(image):
    bundle = registry.get(_KEY, _load)
    height, width = image.shape[:2]
    with _LOCK:
        bundle["detector"].setInputSize((width, height))
        _, faces = bundle["detector"].detect(image)
    if faces is None or len(faces) == 0:
        return None
    return max(faces, key=lambda f: f[2] * f[3])


def _embed(image, face):
    import numpy as np

    recognizer = registry.get(_KEY, _load)["recognizer"]
    aligned = recognizer.alignCrop(image, face)
    vector = recognizer.feature(aligned).reshape(-1).astype("float32")
    norm = float(np.linalg.norm(vector)) or 1.0
    return vector / norm


def _box(face, image) -> list[float]:
    height, width = image.shape[:2]
    x, y, w, h = (float(v) for v in face[:4])
    return [x / width, y / height, w / width, h / height]


def _find_face(raw: bytes) -> tuple[object, object, FaceResult | None]:
    """Decode and detect. Returns (image, face, None) or (.., .., failure)."""
    if not available():
        return None, None, FaceResult(
            "unavailable",
            message_hi="कैमरा पहचान अभी उपलब्ध नहीं है। अपनी फोटो पर टैप करें।",
            message_en="Face recognition is not available. Tap your photo instead.",
        )
    image = _decode(raw)
    face = _largest_face(image)
    if face is None:
        return image, None, FaceResult(
            "no_face",
            message_hi="चेहरा नहीं दिखा। कैमरे के सामने आइए।",
            message_en="No face found. Look at the camera.",
        )
    if face[2] < MIN_FACE_PX:
        return image, face, FaceResult(
            "too_small", box=_box(face, image),
            message_hi="थोड़ा पास आइए।",
            message_en="Come a little closer.",
        )
    return image, face, None


def enroll(operator_id: str, raw: bytes) -> FaceResult:
    image, face, failure = _find_face(raw)
    if failure:
        return failure
    vector = _embed(image, face)
    with _LOCK:
        data = _read_store()
        samples = data.setdefault(operator_id, [])
        samples.append([float(v) for v in vector])
        del samples[:-MAX_SAMPLES]
        _write_store(data)
        count = len(samples)
    return FaceResult(
        "enrolled", operator_id=operator_id, score=float(count), box=_box(face, image),
        message_hi=f"चेहरा सहेज लिया गया। {count} में से {MAX_SAMPLES}।",
        message_en=f"Face saved. {count} of {MAX_SAMPLES}.",
    )


def identify(raw: bytes) -> FaceResult:
    import numpy as np

    image, face, failure = _find_face(raw)
    if failure:
        return failure
    vector = _embed(image, face)
    box = _box(face, image)

    store = _read_store()
    if not store:
        return FaceResult(
            "unknown", box=box,
            message_hi="अभी कोई चेहरा दर्ज नहीं है। पहली बार अपनी फोटो पर टैप करें।",
            message_en="No faces enrolled yet. Tap your photo the first time.",
        )

    # Best similarity per operator, across all of their samples.
    scores = sorted(
        ((float(np.max(np.asarray(vectors, dtype="float32") @ vector)), operator_id)
         for operator_id, vectors in store.items() if vectors),
        reverse=True,
    )
    best_score, best_id = scores[0]
    runner_up = scores[1][0] if len(scores) > 1 else 0.0

    if best_score >= MATCH_THRESHOLD and best_score - runner_up >= MATCH_MARGIN:
        return FaceResult("match", operator_id=best_id, score=best_score,
                          runner_up=runner_up, box=box)
    return FaceResult(
        "unknown", score=best_score, runner_up=runner_up, box=box,
        message_hi="पहचान नहीं हो पाई। सीधे कैमरे में देखिए।",
        message_en="Could not recognise you. Look straight at the camera.",
    )


def info() -> dict:
    return {
        "enabled": settings.enable_face,
        "models_present": all((MODEL_DIR / name).exists() for name, _ in MODELS.values()),
        "enrolled": enrolled(),
        "threshold": MATCH_THRESHOLD,
        "margin": MATCH_MARGIN,
    }
