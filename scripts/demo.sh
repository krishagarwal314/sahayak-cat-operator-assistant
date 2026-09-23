#!/usr/bin/env bash
# Start the demo. One command, self-checking, safe defaults.
#
#   bash scripts/demo.sh
#
# Deliberately does NOT use `set -e`: a failing check should be reported in the
# summary, not kill the script. The server keeps running either way, because a
# partly-working demo is still a demo.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${ROOT}/server.log"
PORT="${PORT:-8000}"

# Translation is the least important model and the most fragile. Off unless you
# ask for it: task text falls back to curated Hindi that reads better anyway.
export ENABLE_TRANSLATE="${ENABLE_TRANSLATE:-0}"
export EAGER_LOAD_MODELS=1
export PYTHONUNBUFFERED=1

if [[ -x "${ROOT}/backend/.venv/bin/python" ]]; then PY="${ROOT}/backend/.venv/bin/python"
elif command -v python  >/dev/null 2>&1;            then PY="python"
else                                                     PY="python3"; fi

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }
bold()  { printf '\033[1m%s\033[0m' "$1"; }

PASS=(); FAIL=()
ok()   { PASS+=("$1"); printf '  %s %s\n' "$(green '[ok]')"   "$1"; }
bad()  { FAIL+=("$1"); printf '  %s %s\n' "$(red   '[FAIL]')" "$1"; }

printf '\n%s\n' "$(bold '==> updating')"
git -C "$ROOT" pull --quiet --ff-only 2>/dev/null && echo "  pulled latest" || echo "  skipped (local changes or no network)"

# ---------------------------------------------------------------- frontend
if [[ ! -f "${ROOT}/frontend/dist/index.html" ]]; then
  printf '\n%s\n' "$(bold '==> building frontend (was missing)')"
  ( cd "${ROOT}/frontend" && { [[ -d node_modules ]] || npm install --no-audit --no-fund --silent; } && npm run build ) \
    || echo "  frontend build failed - the API will still run"
fi

# ---------------------------------------------------------------- restart
printf '\n%s\n' "$(bold "==> starting server on port ${PORT}")"
# Clear out anything left from a previous run.
pkill -f "uvicorn app.main:app" 2>/dev/null && sleep 2
: > "$LOG"

( cd "${ROOT}/backend" && "$PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" >>"$LOG" 2>&1 ) &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT INT TERM

echo "  loading models, this can take a few minutes the first time"
UP=0
for i in $(seq 1 420); do
  if curl -fsS "http://localhost:${PORT}/api/system/health" >/dev/null 2>&1; then UP=1; break; fi
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    printf '\n%s\n' "$(red '  server died during startup. Last 30 lines:')"
    tail -30 "$LOG"; exit 1
  fi
  [[ $((i % 15)) -eq 0 ]] && printf '  ... %ss\n' "$i"
  sleep 1
done

if [[ $UP -eq 0 ]]; then
  printf '\n%s\n' "$(red '  server never became healthy. Last 30 lines:')"
  tail -30 "$LOG"; exit 1
fi

# ---------------------------------------------------------------- checks
printf '\n%s\n' "$(bold '==> checking')"

curl -fsS "http://localhost:${PORT}/" 2>/dev/null | grep -q '<div id="root">' \
  && ok "web UI is being served" || bad "web UI NOT served - run: cd frontend && npm run build"

MODELS=$(curl -fsS "http://localhost:${PORT}/api/system/models" 2>/dev/null)
check_model() {
  local role="$1" label="$2" required="$3"
  local state
  state=$(printf '%s' "$MODELS" | "$PY" -c "
import sys,json
r=json.load(sys.stdin)['registry']
role='$role'
print('failed' if role in r['failed'] else ('loaded' if role in r['loaded'] else 'idle'))" 2>/dev/null)
  case "$state" in
    loaded) ok "$label" ;;
    *) if [[ "$required" == "yes" ]]; then bad "$label (state: $state)"; else
         printf '  %s %s (optional, state: %s)\n' "$(green '[--]')" "$label" "$state"; fi ;;
  esac
}
check_model stt   "speech to text (Hindi)"   yes
check_model tts   "text to speech (Hindi)"   yes
check_model embedder "semantic intent matching" no

command -v ffmpeg >/dev/null 2>&1 && ok "ffmpeg present (decodes browser audio)" \
  || bad "ffmpeg MISSING - voice input will fail. Run: apt-get install -y ffmpeg"

TOKEN=$(curl -fsS -X POST "http://localhost:${PORT}/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"username":"OP1001","password":"cat1234"}' 2>/dev/null \
  | "$PY" -c 'import sys,json; print(json.load(sys.stdin)["token"])' 2>/dev/null)
[[ -n "${TOKEN:-}" ]] && ok "login works (OP1001 / cat1234)" || bad "login FAILED"

if [[ -n "${TOKEN:-}" ]]; then
  RESULT=$(curl -fsS -X POST "http://localhost:${PORT}/api/assistant/ask" \
    -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d '{"machine_id":"EXC001","text":"कितना ईंधन बचा है","language":"hi","speak":true}' 2>/dev/null)

  printf '%s' "$RESULT" | "$PY" -c "
import sys, json, base64, pathlib
d = json.load(sys.stdin)
print('  question : कितना ईंधन बचा है')
print(f\"  intent   : {d['route']['intent']} via {d['route']['stage']} ({d['route']['total_ms']} ms)\")
print(f\"  answer   : {d['reply']['text']['hi']}\")
a = d.get('audio')
if a:
    p = pathlib.Path('${ROOT}/demo_test.wav')
    p.write_bytes(base64.b64decode(a['base64']))
    print(f\"  audio    : {a['duration_s']}s -> {p}\")
else:
    print('  audio    : NONE')
" 2>/dev/null && ok "question answered end to end" || bad "question pipeline FAILED"

  printf '%s' "$RESULT" | grep -q '"audio": *{' && ok "Hindi speech generated" \
    || bad "no audio returned - browser will synthesise instead (demo still works)"
fi

# ---------------------------------------------------------------- summary
echo
if [[ ${#FAIL[@]} -eq 0 ]]; then
  printf '%s\n' "$(green '================ ALL CHECKS PASSED ================')"
else
  printf '%s\n' "$(red "============ ${#FAIL[@]} CHECK(S) FAILED ============")"
  for f in "${FAIL[@]}"; do printf '  %s %s\n' "$(red '-')" "$f"; done
  echo
  echo "  Paste the output of this for help:"
  echo "      bash scripts/doctor.sh"
fi

cat <<EOF

$(bold 'NEXT:') expose port ${PORT} over HTTPS, then open it on your laptop.
   Lightning AI : Ports panel in the Studio -> add port ${PORT}
   anywhere else: cloudflared tunnel --url http://localhost:${PORT}

   Sign in: OP1001 / cat1234
   Then hold the mic and say:  कितना ईंधन बचा है

   The mic ONLY works on the https:// URL, never on http:// or an IP.

$(if [[ -f "${ROOT}/demo_test.wav" ]]; then
    echo "   Play ${ROOT}/demo_test.wav to hear the Hindi voice before you present."
  else
    echo "   (no test audio produced - the browser will speak the replies instead)"
  fi)
   Server log: ${LOG}

Leave this terminal open. Ctrl-C stops the server.
EOF

wait $SERVER_PID
