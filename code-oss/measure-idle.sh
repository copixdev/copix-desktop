#!/usr/bin/env bash
# Sample idle RSS of a built Copix / Code-OSS binary.
# Usage: code-oss/measure-idle.sh /path/to/Copix
set -euo pipefail
bin="${1:-}"
if [[ -z "$bin" || ! -x "$bin" ]]; then
  echo "usage: $0 /path/to/copix-binary" >&2
  exit 2
fi
out="${2:-code-oss/idle-ram.txt}"
# Extensions stay enabled so the Copix agent is part of the idle sample.
"$bin" --disable-gpu --no-sandbox &
pid=$!
sleep 20
# The shell spawns helpers. Sum RSS of the process tree.
rss_kb=$(ps -o rss= -g "$pid" 2>/dev/null | awk '{s+=$1} END {print s+0}')
if [[ "$rss_kb" -eq 0 ]]; then
  rss_kb=$(ps -o rss= -p "$pid" | awk '{print $1+0}')
fi
kill "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true
mb=$(awk -v kb="$rss_kb" 'BEGIN {printf "%.0f", kb/1024}')
{
  echo "idle_rss_kb=$rss_kb"
  echo "idle_rss_mb=$mb"
  echo "binary=$bin"
  echo "note=Linux sample of the Code-OSS shell a few seconds after launch. macOS idle RAM is measured on the arm64 build."
} | tee "$out"
