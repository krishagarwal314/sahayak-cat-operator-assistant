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

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import REPO_DIR, settings
from .routers import assistant, auth, face_auth, guides, machines, manager, safety, system, tasks, training, voice

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("saathi")

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


for module in (auth, face_auth, tasks, machines, assistant, voice, guides, manager, safety, training, system):
    app.include_router(module.router)


@app.get("/api")
def api_root() -> dict:
    return {
        "app": settings.app_name,
        "version": settings.version,
        "docs": "/docs",
        "health": "/api/system/health",
        "profile": settings.profile,
    }


# ---------------------------------------------------------------------------
# Serve the built frontend from the same origin as the API.
#
# This is what makes a remote demo practical: one port means one HTTPS tunnel,
# and the microphone only works in a secure context. It also removes CORS from
# the picture entirely. Falls back to API-only when the frontend has not been
# built, so `npm run dev` on :5173 with its proxy still works for development.
# ---------------------------------------------------------------------------
FRONTEND_DIST = REPO_DIR / "frontend" / "dist"

if (FRONTEND_DIST / "index.html").is_file():
    if (FRONTEND_DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        """Static file if it exists, otherwise index.html so client routing works."""
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (FRONTEND_DIST / path).resolve()
        # Keep path traversal out: the resolved path must stay inside dist.
        if path and candidate.is_file() and candidate.is_relative_to(FRONTEND_DIST.resolve()):
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")

    log.info("serving frontend from %s", FRONTEND_DIST)
else:
    @app.get("/", include_in_schema=False)
    def no_frontend() -> dict:
        return {
            "app": settings.app_name,
            "note": "Frontend not built. Run: cd frontend && npm run build",
            "api": "/api",
            "docs": "/docs",
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
        # Pay the load cost at boot so the first question of a demo is not the
        # slow one. Each of these degrades to a no-op if the model is absent.
        from .ai import face, stt, translate, tts
        from .ai.intent import embedder as intent_embedder

        log.info("eager loading models ...")
        for name, warm in (
            ("embedder", intent_embedder.warm),
            ("stt", stt.available),
            ("tts", tts.available),
            ("tts_en", tts.available_en),
            ("translate", translate.available),
            ("face", face.available),
        ):
            log.info("  %-10s %s", name, "ready" if warm() else "unavailable")
