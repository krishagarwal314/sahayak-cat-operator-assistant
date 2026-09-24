#!/usr/bin/env bash
# Turn recorded WAV clips into the small MP3s the offline demo ships.
#   bash scripts/compress_voices.sh
# Mono 48 kbps keeps speech clear at about a tenth of the size.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backend/voices"
n=0
for wav in "$DIR"/*.wav; do
  [[ -e "$wav" ]] || continue
  mp3="${wav%.wav}.mp3"
  if [[ ! -f "$mp3" || "$wav" -nt "$mp3" ]]; then
    ffmpeg -loglevel error -y -i "$wav" -ac 1 -b:a 48k "$mp3" && n=$((n + 1))
  fi
done
echo "compressed $n clips; $(ls "$DIR"/*.mp3 2>/dev/null | wc -l) MP3s, $(du -sh "$DIR" | cut -f1) total (WAVs are not committed)"
