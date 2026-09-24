#!/usr/bin/env bash
# macOS: set everything up the first time, then start. One command:
#
#   bash scripts/mac.sh
#
# Tuned for a laptop CPU. The scripted demo mic does not need speech
# recognition or the embedding model, so both stay off: less to download, less
# memory, a faster start. The speech model runs on the CPU, where every
# operation it uses is supported (Apple's GPU path is not reliable for it), on
# the performance cores. Replies are cached, so each sentence is only ever
# synthesised once.
#
# Want live speech recognition as well?  ENABLE_STT=1 bash scripts/mac.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is needed first:"
  echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  exit 1
fi
BREW="$(brew --prefix)"

echo "==> system packages"
for pkg in python@3.11 node ffmpeg espeak-ng; do
  brew list "$pkg" >/dev/null 2>&1 || brew install "$pkg"
done

VENV="$ROOT/backend/.venv"
STAMP="$VENV/.requirements-installed"
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "==> python environment"
  "$BREW/bin/python3.11" -m venv "$VENV"
fi
if [[ ! -f "$STAMP" || "$ROOT/backend/requirements.txt" -nt "$STAMP" ]]; then
  echo "==> python packages (first time takes a few minutes)"
  "$VENV/bin/pip" install -q -U pip
  "$VENV/bin/pip" install -q torch
  "$VENV/bin/pip" install -q -r "$ROOT/backend/requirements.txt" && touch "$STAMP"
fi

# English pronunciation: tell the phonemizer where Homebrew put espeak-ng.
export PHONEMIZER_ESPEAK_LIBRARY="$BREW/lib/libespeak-ng.dylib"
export DEVICE=cpu
export ENABLE_STT="${ENABLE_STT:-0}"
export ENABLE_EMBEDDER="${ENABLE_EMBEDDER:-0}"
export ENABLE_TRANSLATE=0
# One thread per performance core: more threads than that only slow torch down.
CORES="$(sysctl -n hw.perflevel0.physicalcpu 2>/dev/null || sysctl -n hw.physicalcpu)"
export OMP_NUM_THREADS="$CORES" MKL_NUM_THREADS="$CORES"
export TOKENIZERS_PARALLELISM=false

echo "==> starting on http://localhost:8000"
exec bash "$ROOT/scripts/demo.sh"
