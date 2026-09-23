#!/usr/bin/env bash
# Generates small test clips in public/samples (requires ffmpeg on PATH or
# FFMPEG=/path/to/ffmpeg). Patterns + moving elements + a tone make A/V sync,
# dropped frames and seeking easy to eyeball.
set -euo pipefail
FFMPEG="${FFMPEG:-ffmpeg}"
OUT="$(dirname "$0")/../public/samples"
mkdir -p "$OUT"

SRC=(-f lavfi -i "testsrc2=size=1024x576:rate=30:duration=12"
     -f lavfi -i "sine=frequency=440:beep_factor=4:sample_rate=48000:duration=12")

# Open codecs (work in every Chromium build): VP9 + Opus, fast-start.
"$FFMPEG" -y -hide_banner -loglevel error "${SRC[@]}" \
  -c:v libvpx-vp9 -b:v 300k -g 60 -deadline realtime -cpu-used 8 -row-mt 1 \
  -c:a libopus -b:a 64k -ac 2 -movflags +faststart "$OUT/sample-vp9-opus.mp4"

# Proprietary codecs: H.264 (B-frames) + AAC, moov at the END to exercise
# the demuxer's range-jump logic.
"$FFMPEG" -y -hide_banner -loglevel error "${SRC[@]}" \
  -c:v libx264 -preset veryfast -profile:v high -b:v 350k -g 60 -bf 2 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -ac 2 "$OUT/sample-h264-aac.mp4"

ls -lh "$OUT"
