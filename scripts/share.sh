#!/usr/bin/env bash
# Put an HTTPS URL in front of the running server.
#
#   bash scripts/share.sh
#
# Run this in a SECOND terminal, with scripts/demo.sh still running in the first.
# The microphone only works on a secure origin, which is the whole point of this.
#
# PREFER your cloud provider's own port sharing if it has one (Lightning AI
# does). Cloudflare quick tunnels sometimes publish an IPv6-only record for the
# generated hostname, and on a network without IPv6 the name then half-resolves
# with nowhere to connect - the browser reports a DNS error and the tunnel looks
# broken when it is actually fine. Check from the machine that will open the
# link, not from the server:
#     curl -4 -sI https://<generated>.trycloudflare.com   # no IPv4 path => this
# If that fails while the same URL works from the server, use the provider'"'"'s
# port sharing or ngrok instead.

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
    printf '  then    : tap the yellow button, look at the camera\n'
    printf '  say     : कितना ईंधन बचा है\n'
    printf '\033[32m%s\033[0m\n\n' "======================================================"
    echo "Leave this terminal open. Ctrl-C closes the tunnel."
  fi
done
