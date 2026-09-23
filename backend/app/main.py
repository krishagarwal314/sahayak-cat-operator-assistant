"""Sahayak - Smart Operator Assistant for CAT machines.

    uvicorn app.main:app --reload --port 8000

The API boots without any model downloaded: speech, translation and the
embedding stage all degrade gracefully, and the keyword router still answers.
Download the models when you want the full voice experience:

    python scripts/download_models.py
"""

from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .routers import assistant, auth, machines, safety, system, tasks, training, voice

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("sahayak")

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=(
        "A machine-aware, voice-first assistant for CAT machine operators. "
        "Intent classification runs locally through a staged router; a large "
        "language model is never in the request path."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-TTS-Engine", "X-TTS-Latency-Ms", "X-Response-Ms"],
)


@app.middleware("http")
async def timing(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Response-Ms"] = f"{(time.perf_counter() - started) * 1000:.1f}"
    return response


@app.exception_handler(KeyError)
async def key_error_handler(_: Request, exc: KeyError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": f"Not found: {exc}"})


for module in (auth, tasks, machines, assistant, voice, safety, training, system):
    app.include_router(module.router)


@app.get("/")
def root() -> dict:
    return {
        "app": settings.app_name,
        "version": settings.version,
        "docs": "/docs",
        "health": "/api/system/health",
        "profile": settings.profile,
    }


@app.on_event("startup")
def startup() -> None:
    log.info("%s v%s", settings.app_name, settings.version)
    log.info("model profile: %s", settings.profile)
    log.info("  stt       : %s (%s)", settings.stt_model, "on" if settings.enable_stt else "off")
    log.info("  tts       : %s (%s)", settings.tts_model, "on" if settings.enable_tts else "off")
    log.info("  translate : %s (%s)", settings.translate_model, "on" if settings.enable_translate else "off")
    log.info("  embedder  : %s (%s)", settings.embedder_model, "on" if settings.enable_embedder else "off")
    log.info("  intent    : %s", settings.intent_model_dir)

    if settings.eager_load:
        from .ai.intent import embedder as intent_embedder

        log.info("eager loading models ...")
        intent_embedder.warm()
