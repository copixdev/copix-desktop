#!/usr/bin/env bash
# Launch Copix Studio dev server (macOS)
set -euo pipefail
cd "$(dirname "$0")/studio"
exec npm run dev
