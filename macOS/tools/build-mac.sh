#!/usr/bin/env bash
# Build Copix macOS installer (.dmg + .zip) — run from repo macOS/ folder
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/studio/scripts/build-mac.sh"
