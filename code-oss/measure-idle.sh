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
# Proportional set size counts shared libraries once. Summed RSS counts them in every process.
pss_kb=$(python3 - "$pid" << 'PY'
import os, sys
root = int(sys.argv[1])
rows = []
for name in os.listdir("/proc"):
    if not name.isdigit():
        continue
    try:
        ppid = int(open(f"/proc/{name}/status").read().split("PPid:")[1].split()[0])
    except OSError:
        continue
    rows.append((int(name), ppid))
targets = {root}
changed = True
while changed:
    changed = False
    for pid, ppid in rows:
        if ppid in targets and pid not in targets:
            targets.add(pid)
            changed = True
total = 0
for pid in targets:
    try:
        text = open(f"/proc/{pid}/smaps_rollup").read()
    except OSError:
        continue
    for line in text.splitlines():
        if line.startswith("Pss:"):
            total += int(line.split()[1])
print(total)
PY
)
kill "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true
mb=$(awk -v kb="$rss_kb" 'BEGIN {printf "%.0f", kb/1024}')
pss_mb=$(awk -v kb="$pss_kb" 'BEGIN {printf "%.0f", kb/1024}')
{
  echo "idle_rss_kb=$rss_kb"
  echo "idle_rss_mb=$mb"
  echo "idle_pss_kb=$pss_kb"
  echo "idle_pss_mb=$pss_mb"
  echo "binary=$bin"
  echo "note=Linux sample. RSS sums every process and double-counts shared libraries. PSS is the unique footprint."
} | tee "$out"
