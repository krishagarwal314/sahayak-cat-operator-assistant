#!/usr/bin/env bash
# Put an HTTPS URL in front of the running server.
#
#   bash scripts/share.sh
#
# Run this in a SECOND terminal, with scripts/demo.sh still running in the first.
# The microphone only works on a secure origin, which is the whole point of this.

set -uo pipefail
PORT="${PORT:-8000}"
BIN="${HOME}/.local/bin/cloudflared"

if ! curl -fsS "http://localhost:${PORT}/api/system/health" >/dev/null 2>&1; then
  echo "Nothing is running on port ${PORT}."
  echo "Start the server first, in another terminal:  bash scripts/demo.sh"
  exit 1
fi
echo "server is up on :${PORT}"

if [[ ! -x "$BIN" ]]; then
  echo "downloading cloudflared ..."
  mkdir -p "$(dirname "$BIN")"
  arch=$(uname -m)
  case "$arch" in
    x86_64|amd64) suffix="amd64" ;;
    aarch64|arm64) suffix="arm64" ;;
    *) echo "unsupported architecture: $arch"; exit 1 ;;
  esac
  curl -fsSL -o "$BIN" \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${suffix}" \
    || { echo "download failed - check network"; exit 1; }
  chmod +x "$BIN"
fi

echo "opening tunnel, this takes a few seconds ..."
echo

# cloudflared prints the URL on stderr among a lot of other noise; pull it out
# and show it on its own so it cannot be missed, then keep the tunnel running.
"$BIN" tunnel --url "http://localhost:${PORT}" --no-autoupdate 2>&1 | while IFS= read -r line; do
  if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
    url="${BASH_REMATCH[1]}"
    printf '\n\033[32m%s\033[0m\n' "======================================================"
    printf '  \033[1mOPEN THIS ON YOUR LAPTOP:\033[0m\n'
    printf '    \033[36m%s\033[0m\n\n' "$url"
    printf '  sign in : OP1001 / cat1234\n'
    printf '  then say: कितना ईंधन बचा है\n'
    printf '\033[32m%s\033[0m\n\n' "======================================================"
    echo "Leave this terminal open. Ctrl-C closes the tunnel."
  fi
done
