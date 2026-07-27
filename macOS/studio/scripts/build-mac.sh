#!/usr/bin/env bash
# Build official Copix macOS app (.dmg + .zip) — Mac-only product
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Copix macOS build"
echo "Working directory: $(pwd)"

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "Error: Copix is a macOS-only app. Build on a Mac (e.g. /Users/{username})."
	exit 1
fi

if [[ ! -d node_modules/electron-builder ]]; then
	echo "[1/3] Installing dependencies (including electron-builder)..."
	npm install
else
	echo "[1/3] Dependencies present — refreshing Electron binary for macOS…"
	node scripts/install-electron.mjs
fi

# macOS Electron lives at dist/Electron.app/... — repair if a prior Windows/Linux extract left a bare "electron"
if [[ ! -x node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ]]; then
	echo "[1b/3] Repairing Electron.app…"
	rm -rf node_modules/electron/dist
	node scripts/install-electron.mjs
fi

echo "[2/3] Building app + packaging macOS installer..."
npm run dist

echo "[3/3] Artifacts:"
find release release/staging -maxdepth 2 \( -name '*.dmg' -o -name '*.zip' -o -name 'Copix.app' \) 2>/dev/null | while read -r f; do
	size=$(du -h "$f" 2>/dev/null | awk '{print $1}')
	echo "  $f  ($size)"
done
echo "Done. Install from studio/release/Copix-*-mac-*.dmg (or open Copix.app)."
echo "Recommended home directory: /Users/{username}"
