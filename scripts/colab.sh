#!/usr/bin/env bash
# Everything a fresh Google Colab instance needs, then start the app.
#
#   !bash scripts/colab.sh
#
# Colab ships its own numpy 2 / OpenCV stack (and Python 3.13), so the numpy<2
# and OpenCV pins in requirements.txt are skipped here: forcing them makes pip
# build numpy from source. The server runs in the background so the cell ends;
# watch it with  !tail -40 /content/demo.out
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> system packages (espeak-ng for English, ffmpeg for audio)"
apt-get update -qq >/dev/null && apt-get install -y -qq espeak-ng ffmpeg >/dev/null

if ! node -v 2>/dev/null | grep -qE '^v(1[89]|2[0-9])'; then
  echo "==> Node 20 for the web UI"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
echo "    node $(node -v)"

echo "==> python packages"
grep -vE '^(numpy|opencv)' "$ROOT/backend/requirements.txt" > /tmp/saathi-req.txt
pip install -q -r /tmp/saathi-req.txt pyngrok

python - <<'PY'
import torch
print("    GPU:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none - Runtime > Change runtime type > T4 GPU")
PY

echo "==> starting (first run downloads the speech models, 5-10 minutes)"
nohup bash "$ROOT/scripts/demo.sh" > /content/demo.out 2>&1 &
echo "    started. Watch it with:  !tail -40 /content/demo.out"
