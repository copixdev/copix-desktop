#!/usr/bin/env bash
# Clear macOS Gatekeeper quarantine so Copix.app can open after a browser download.
# curl -fsSL https://raw.githubusercontent.com/copixdev/copix-desktop/main/release/fix-macos-quarantine.sh | bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for macOS only."
  exit 1
fi

APP=""
for candidate in \
  "/Applications/Copix.app" \
  "$HOME/Applications/Copix.app" \
  "/Applications/Copix Studio.app" \
  "$HOME/Desktop/Copix.app"
do
  if [[ -d "$candidate" ]]; then
    APP="$candidate"
    break
  fi
done

# Also check mounted DMG volumes
if [[ -z "$APP" ]]; then
  for vol in /Volumes/Copix* /Volumes/copix*; do
    if [[ -d "$vol/Copix.app" ]]; then
      APP="$vol/Copix.app"
      break
    fi
  done
fi

if [[ -z "$APP" ]]; then
  echo "Copix.app not found."
  echo "1) Open the DMG and drag Copix into Applications"
  echo "2) Re-run this script"
  exit 1
fi

echo "Clearing quarantine on: $APP"
xattr -cr "$APP"
echo "Opening…"
open "$APP"
echo "Done. If macOS still blocks it: Control-click the app → Open → Open."
