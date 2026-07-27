#!/usr/bin/env bash
# Copix Core — install tuning deps into .venv (Python 3.10–3.12)
# macOS / Linux counterpart to setup.ps1 (uses MPS/CPU torch, not CUDA).
set -euo pipefail
cd "$(dirname "$0")"

find_python() {
	for candidate in python3.12 python3.11 python3.10 python3; do
		if command -v "$candidate" >/dev/null 2>&1; then
			if "$candidate" -c 'import sys; v=sys.version_info; raise SystemExit(0 if (3,10)<= (v.major,v.minor)<=(3,12) else 1)'; then
				echo "$candidate"
				return 0
			fi
		fi
	done
	return 1
}

echo ""
echo "Copix Core — install tuning dependencies (macOS/Linux)"
echo ""

PIP="./.venv/bin/python"
if [[ ! -x "$PIP" ]]; then
	PY="$(find_python)" || {
		echo "ERROR: Need Python 3.10–3.12. Install from python.org or Homebrew (brew install python@3.11)"
		echo "Then: python3.11 -m venv .venv"
		exit 1
	}
	echo "Creating .venv with $PY..."
	"$PY" -m venv .venv
fi

VER="$("$PIP" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
echo "Using venv Python $VER"

"$PIP" -m pip install --upgrade pip wheel setuptools

echo ""
echo "Installing PyTorch (CPU / Apple MPS)..."
"$PIP" -m pip uninstall -y torch torchvision torchaudio 2>/dev/null || true
"$PIP" -m pip install torch torchvision torchaudio

echo ""
echo "Installing transformers, peft, datasets..."
"$PIP" -m pip install -r requirements.txt

echo ""
"$PIP" -c '
import torch
print("torch", torch.__version__)
print("mps=", getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
print("cuda=", torch.cuda.is_available())
'

echo ""
echo "Done. Run: .venv/bin/python train_gpt_oss.py --epochs 3"
echo ""
