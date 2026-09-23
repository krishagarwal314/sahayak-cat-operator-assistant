#!/usr/bin/env bash
# Collect everything needed to diagnose a broken demo, in one paste-able block.
#
#   bash scripts/doctor.sh
#
# Reads only. Prints no tokens.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8000}"

if [[ -x "${ROOT}/backend/.venv/bin/python" ]]; then PY="${ROOT}/backend/.venv/bin/python"
elif command -v python >/dev/null 2>&1;             then PY="python"
else                                                     PY="python3"; fi

section() { printf '\n----- %s -----\n' "$1"; }

echo "===== SAHAYAK DOCTOR ====="
date

section "machine"
uname -srm
echo "python : $("$PY" --version 2>&1)"
echo "node   : $(command -v node >/dev/null && node --version || echo MISSING)"
echo "ffmpeg : $(command -v ffmpeg >/dev/null && echo present || echo MISSING)"
echo "free   : $(free -h 2>/dev/null | awk '/Mem:/{print $7" available of "$2}' || echo n/a)"
echo "disk   : $(df -h "$ROOT" 2>/dev/null | awk 'NR==2{print $4" free"}')"

section "gpu"
"$PY" - <<'PYEOF' 2>&1 | sed 's/^/  /'
try:
    import torch
    print("torch  :", torch.__version__)
    print("cuda   :", torch.cuda.is_available(),
          torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")
    major, minor = (int(x) for x in torch.__version__.split(".")[:2])
    if (major, minor) < (2, 6):
        print("WARNING: torch < 2.6 cannot load the pickle-only checkpoints")
except Exception as exc:
    print("torch import failed:", exc)
PYEOF

section "key packages"
"$PY" - <<'PYEOF' 2>&1 | sed 's/^/  /'
for name in ("transformers", "soundfile", "librosa", "fastapi", "uvicorn", "IndicTransToolkit"):
    try:
        mod = __import__(name)
        print(f"{name:20s} {getattr(mod, '__version__', 'installed')}")
    except Exception:
        print(f"{name:20s} MISSING")
PYEOF

section "repo"
echo "path   : $ROOT"
echo "commit : $(git -C "$ROOT" log --oneline -1 2>/dev/null || echo 'not a git repo')"
echo "dirty  : $(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l) modified files"
echo "frontend/dist/index.html : $([[ -f "$ROOT/frontend/dist/index.html" ]] && echo present || echo MISSING)"
echo "intent classifier        : $([[ -f "$ROOT/backend/models/intent-classifier/config.json" ]] && echo trained || echo 'not trained (fine)')"

section "env (model-related only)"
for v in MODEL_PROFILE STT_MODEL TTS_MODEL TRANSLATE_MODEL EMBEDDER_MODEL DEVICE \
         ENABLE_STT ENABLE_TTS ENABLE_TRANSLATE ENABLE_EMBEDDER EAGER_LOAD_MODELS; do
  printf '  %-20s %s\n' "$v" "${!v:-<unset>}"
done
printf '  %-20s %s\n' "HF_TOKEN" "$([[ -n "${HF_TOKEN:-}" ]] && echo '<set>' || echo '<unset>')"

section "downloaded models"
CACHE="${HF_HOME:-$HOME/.cache/huggingface}/hub"
if [[ -d "$CACHE" ]]; then
  du -sh "$CACHE"/models--* 2>/dev/null | sed 's/^/  /' | head -20
else
  echo "  no hub cache at $CACHE"
fi

section "server"
if curl -fsS "http://localhost:${PORT}/api/system/health" >/dev/null 2>&1; then
  echo "  responding on :${PORT}"
  curl -fsS "http://localhost:${PORT}/api/system/models" 2>/dev/null | "$PY" - <<'PYEOF' 2>&1 | sed 's/^/  /'
import sys, json
d = json.load(sys.stdin)
r = d["registry"]
print("profile:", r["profile"], "| device:", r["device"])
for role, name in r["configured"].items():
    state = "FAILED" if role in r["failed"] else ("loaded" if role in r["loaded"] else "idle")
    print(f"  {role:11s} {state:8s} {name}")
for role, why in r.get("failed", {}).items():
    print(f"  ! {role}: {why[:200]}")
print("taxonomy:", d.get("taxonomy"))
print("translate info:", d.get("translate"))
PYEOF
  echo "  serving UI: $(curl -fsS "http://localhost:${PORT}/" 2>/dev/null | grep -qc 'id="root"' && echo yes || echo NO)"
else
  echo "  NOT responding on :${PORT}"
fi

section "server log (last 40 lines, httpx noise removed)"
if [[ -f "${ROOT}/server.log" ]]; then
  grep -v 'httpx:' "${ROOT}/server.log" | tail -40 | sed 's/^/  /'
else
  echo "  no server.log - start with: bash scripts/demo.sh"
fi

echo
echo "===== END ====="
