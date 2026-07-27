#!/usr/bin/env python3
"""
Deprecated for Qwen merges.

Copix Core now trains on openai/gpt-oss-20b via train_gpt_oss.py.
This script forwards to export_ollama.py when a gpt-oss merge exists.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OSS_MERGED = ROOT / "output" / "copix-gpt-oss-merged"


def main() -> None:
    if not OSS_MERGED.exists():
        print(
            "ERROR: gpt-oss merge missing.\n"
            "  Run: powershell -File train.ps1\n"
            "  (trains openai/gpt-oss-20b LoRA and writes output/copix-gpt-oss-merged)\n"
            "  Then: py -3.11 export_ollama.py",
            file=sys.stderr,
        )
        sys.exit(1)
    r = subprocess.run([sys.executable, str(ROOT / "export_ollama.py"), "--name", "copix-core"])
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
