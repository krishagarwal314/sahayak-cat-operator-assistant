#!/usr/bin/env bash
# One-shot setup for a cloud box (Lightning AI Studio, Colab, any Linux VM).
#
#   bash scripts/setup_cloud.sh              # everything: deps, build, models
#   bash scripts/setup_cloud.sh --no-models  # skip the ~3.5 GB download
#   MODEL_PROFILE=quality bash scripts/setup_cloud.sh
#
# Safe to re-run: every step is idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${PYTHON:-python3}"
SKIP_MODELS=0
[[ "${1:-}" == "--no-models" ]] && SKIP_MODELS=1

say() { printf '\n\033[1;33m==>\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

SUDO=""
if [[ "$(id -u)" -ne 0 ]] && have sudo; then SUDO="sudo"; fi

# ---------------------------------------------------------------- ffmpeg
# Browsers record webm/opus, which soundfile cannot read. ffmpeg is the decoder.
say "checking ffmpeg"
if have ffmpeg; then
  echo "    ffmpeg present"
else
  echo "    installing ffmpeg"
  $SUDO apt-get update -qq && $SUDO apt-get install -y -qq ffmpeg
fi

# ---------------------------------------------------------------- python
say "python dependencies"
"$PY" -c "import sys; print(f'    python {sys.version.split()[0]}')"

# torch>=2.6 is required: two checkpoints are pickle-only and transformers
# refuses to torch.load those on older torch.
TORCH_STATE=$("$PY" - <<'PYEOF'
try:
    import torch
    parts = torch.__version__.split('.')
    if (int(parts[0]), int(parts[1])) >= (2, 6):
        print('yes')
    else:
        print(torch.__version__)
except Exception:
    print('missing')
PYEOF
)
if [[ "$TORCH_STATE" == "yes" ]]; then
  echo "    torch OK ($("$PY" -c 'import torch; print(torch.__version__)'))"
else
  echo "    torch is '$TORCH_STATE' - need >= 2.6, installing"
  if "$PY" -c "import torch, sys; sys.exit(0 if torch.cuda.is_available() else 1)" 2>/dev/null; then
    "$PY" -m pip install -q -U torch
  else
    "$PY" -m pip install -q -U torch --index-url https://download.pytorch.org/whl/cpu
  fi
fi

echo "    installing requirements"
"$PY" -m pip install -q -U pip
"$PY" -m pip install -q -r "$ROOT/backend/requirements.txt"

# IndicTrans2 needs its own tokenizer helper; harmless if that model is unused.
if "$PY" -m pip install -q IndicTransToolkit 2>/dev/null; then
  echo "    IndicTransToolkit installed"
else
  echo "    IndicTransToolkit unavailable (task text falls back to curated Hindi)"
fi

# ---------------------------------------------------------------- frontend
say "frontend build"
if ! have npm; then
  echo "    installing node"
  $SUDO apt-get install -y -qq nodejs npm
fi
cd "$ROOT/frontend"
[[ -d node_modules ]] || npm install --no-audit --no-fund --silent
npm run build
echo "    built -> frontend/dist"

# ---------------------------------------------------------------- models
if [[ "$SKIP_MODELS" -eq 0 ]]; then
  say "downloading models (profile: ${MODEL_PROFILE:-balanced})"
  cd "$ROOT/backend"
  "$PY" scripts/download_models.py --profile "${MODEL_PROFILE:-balanced}"
else
  say "skipping model download (--no-models)"
fi

# ---------------------------------------------------------------- intent model
say "intent classifier"
if [[ -f "$ROOT/backend/models/intent-classifier/config.json" ]]; then
  echo "    already trained"
else
  echo "    not trained yet - the router works without it, stage L3 is skipped"
  echo "    to train (a few minutes on GPU):"
  echo "      cd backend && $PY -m app.ai.intent.build_dataset && $PY -m app.ai.intent.train"
fi

say "ready"
cat <<EOF

Start the app on one port (frontend and API served together):

    cd $ROOT/backend
    EAGER_LOAD_MODELS=1 $PY -m uvicorn app.main:app --host 0.0.0.0 --port 8000

Then expose port 8000 over HTTPS. The microphone only works on a secure
origin, so a plain http:// IP address will not do:

    Lightning AI : use the Studio's port-sharing button for port 8000
    anywhere else: cloudflared tunnel --url http://localhost:8000

EOF
