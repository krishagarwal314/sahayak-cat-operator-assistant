#!/usr/bin/env bash
# Start the backend and the frontend together.
#
#   ./run.sh              backend on :8000, frontend on :5173
#   ./run.sh --no-models  same, but every model disabled (fast boot, text only)
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--no-models" ]]; then
  export ENABLE_STT=0 ENABLE_TTS=0 ENABLE_TRANSLATE=0 ENABLE_EMBEDDER=0
  echo "running with all models disabled"
fi

PY="$ROOT/backend/.venv/bin/python"
[[ -x "$PY" ]] || PY="python3"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "backend  -> http://localhost:8000  (docs at /docs)"
( cd "$ROOT/backend" && "$PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload ) &

echo "frontend -> http://localhost:5173"
( cd "$ROOT/frontend" && npm run dev ) &

wait
