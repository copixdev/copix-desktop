#!/usr/bin/env bash
# Launch Copix Studio dev server
set -euo pipefail
cd "$(dirname "$0")"
exec npm run dev
