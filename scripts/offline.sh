#!/usr/bin/env bash
# Run CAT Saathi with no AI model downloads - Mac or Linux.
#
#   bash scripts/offline.sh
#
# Everything the demo shows and says is already in the repo: every spoken line
# is recorded from the real voice models, the web app is prebuilt, the small
# ML models are pretrained. The only download is ~130 MB of Python packages,
# once. The demo clock is frozen so every answer matches its recording.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/backend"

# A Python between 3.10 and 3.12 (macOS's own python3 is too old).
PY=""
for c in python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)' 2>/dev/null; then
    PY="$c"; break
  fi
done
if [[ -z "$PY" ]]; then
  echo "Python 3.10, 3.11 or 3.12 is needed. On a Mac:  brew install python@3.11"
  exit 1
fi

VENV="$ROOT/backend/.venv-offline"
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "==> creating python environment ($("$PY" --version))"
  "$PY" -m venv "$VENV"
fi
if [[ ! -f "$VENV/.installed" || requirements-offline.txt -nt "$VENV/.installed" ]]; then
  echo "==> installing packages (one time, ~130 MB)"
  "$VENV/bin/pip" install -q -U pip
  "$VENV/bin/pip" install -q -r requirements-offline.txt && touch "$VENV/.installed"
fi

# Start every demo from the same task list, so the spoken briefing matches.
rm -f data/tasks.json

export DEMO_TIME=2026-09-24T11:30:00
export TTS_CACHE_ONLY=1 TTS_CACHE_DIR="$ROOT/backend/voices"
export ENABLE_STT=0 ENABLE_EMBEDDER=0 ENABLE_TRANSLATE=0 ENABLE_TTS=1 ENABLE_FACE=1
export WARM_TTS_CACHE=0 EAGER_LOAD_MODELS=0 PYTHONUNBUFFERED=1

if [[ ! -f models/ml/task_time.joblib || ! -f models/ml/safety_risk.joblib || ! -f models/ml/unusual_use.joblib ]]; then
  echo "==> training the small ML models (seconds)"
  "$VENV/bin/python" -m app.ml.train_all >/dev/null
fi

pkill -f "uvicorn app.main:app" 2>/dev/null && sleep 1
echo
echo "================================================"
echo "  CAT Saathi is starting:  http://localhost:8000"
echo "  Log in as Suresh Yadav. Ctrl+C to stop."
echo "================================================"
( sleep 3; command -v open >/dev/null && open http://localhost:8000 ) >/dev/null 2>&1 &
exec "$VENV/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
