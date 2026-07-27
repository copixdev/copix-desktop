#!/usr/bin/env python3
"""
Legacy Qwen trainer — Copix Core now fine-tunes openai/gpt-oss-20b.

Use:
  powershell -File train.ps1
  (runs train_gpt_oss.py)
"""
from __future__ import annotations

import sys

print(
    "NOTE: Copix Core trains on gpt-oss-20b now.\n"
    "  Run:  powershell -File train.ps1\n"
    "  Or:   py -3.11 train_gpt_oss.py --epochs 3\n",
    file=sys.stderr,
)
sys.exit(2)
