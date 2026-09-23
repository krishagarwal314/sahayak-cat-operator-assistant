from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import db, security
from ..ai import face, registry, stt, translate, tts
from ..ai.intent import embedder, router as intent_router
from ..ai.intent.taxonomy import stats as taxonomy_stats
from ..config import settings

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.version,
        "profile": settings.profile,
        "device": registry.resolve_device(),
        "machines": len(db.MACHINES),
        "operators": len(db.OPERATORS),
    }


def _ml_metrics() -> dict:
    from ..ml import safety_risk, task_time, unusual_use

    return {"task_time": task_time.metrics(), "safety_risk": safety_risk.metrics(),
            "unusual_use": unusual_use.metrics()}


@router.get("/models")
def models() -> dict:
    """What is configured, what is actually loaded, and what failed to load."""
    return {
        "registry": registry.status(),
        "stt": stt.info(),
        "tts": tts.info(),
        "translate": translate.info(),
        "face": face.info(),
        "ml": _ml_metrics(),
        "taxonomy": taxonomy_stats(),
    }


@router.get("/router")
def router_explain() -> dict:
    """The routing cascade and its thresholds, for the architecture panel."""
    return intent_router.explain()


@router.post("/warm")
def warm(_: dict = Depends(security.current_operator)) -> dict:
    """Preload the models so the first question of a demo is not the slow one."""
    return {
        "embedder": embedder.warm(),
        "stt": stt.available(),
        "tts": tts.available(),
        "translate": translate.available(),
        "registry": registry.status(),
    }


@router.post("/reset")
def reset(_: dict = Depends(security.current_operator)) -> dict:
    """Reset task status, incidents and history so a demo can be run again."""
    db.reset_runtime_state()
    return {"status": "reset", "tasks": len(db.TASKS)}
