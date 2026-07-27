#!/usr/bin/env python3
"""
Register tuned Copix model in Ollama.

Primary path (8GB GPUs): Qwen2.5-Coder-3B QLoRA → GGUF → `copix-core`
(Ollama's raw safetensors import for Qwen produces garbage; GGUF is required.)
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "output"
CORE_MERGED = OUT_DIR / "copix-core-merged"
CORE_GGUF = OUT_DIR / "copix-core-f16.gguf"
CORE_MODELFILE = OUT_DIR / "CopixCoreModelfile"
OSS_MERGED = OUT_DIR / "copix-gpt-oss-merged"
OSS_MODELFILE = OUT_DIR / "CopixModelfile"
CONVERT_SCRIPT = ROOT / "tools" / "llama.cpp" / "convert_hf_to_gguf.py"

SYSTEM = (
    "You are Copix Core, an expert coding agent in a Cursor-like IDE. "
    "Use tools proactively. Write production code. Explain clearly. "
    "Never invent paths. Never use API keys as filenames."
)

QWEN_TEMPLATE = r"""{{- if .Messages }}
{{- if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}
{{- range $i, $_ := .Messages }}
{{- $last := eq (len (slice $.Messages $i)) 1 -}}
{{- if eq .Role "user" }}<|im_start|>user
{{ .Content }}<|im_end|>
{{ else if eq .Role "assistant" }}<|im_start|>assistant
{{ .Content }}{{ if not $last }}<|im_end|>
{{ end }}
{{- end }}
{{- if and (ne .Role "assistant") $last }}<|im_start|>assistant
{{ end }}
{{- end }}
{{- else }}
{{- if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
{{ end }}{{ .Response }}{{ if .Response }}<|im_end|>{{ end }}"""


def create_from_modelfile(name: str, modelfile: Path) -> int:
    print(f"Creating Ollama model '{name}' from {modelfile}…", flush=True)
    print("(Importing can take a few minutes.)", flush=True)
    r = subprocess.run(
        ["ollama", "create", name, "-f", str(modelfile)],
        capture_output=True,
        text=True,
    )
    if r.stdout:
        print(r.stdout, flush=True)
    if r.stderr:
        print(r.stderr, file=sys.stderr, flush=True)
    return r.returncode


def ensure_gguf() -> Path:
    if CORE_GGUF.exists() and CORE_GGUF.stat().st_size > 1_000_000_000:
        print(f"Using existing GGUF: {CORE_GGUF}", flush=True)
        return CORE_GGUF
    if not CORE_MERGED.exists():
        raise FileNotFoundError(f"Merged HF model missing: {CORE_MERGED}")
    if not CONVERT_SCRIPT.exists():
        raise FileNotFoundError(
            f"Missing {CONVERT_SCRIPT}. Clone llama.cpp into tools/llama.cpp "
            "(git clone --depth 1 https://github.com/ggml-org/llama.cpp.git tools/llama.cpp)"
        )
    print(f"Converting HF → GGUF (f16)…\n  in:  {CORE_MERGED}\n  out: {CORE_GGUF}", flush=True)
    r = subprocess.run(
        [
            sys.executable,
            str(CONVERT_SCRIPT),
            str(CORE_MERGED),
            "--outfile",
            str(CORE_GGUF),
            "--outtype",
            "f16",
        ],
        cwd=str(ROOT),
    )
    if r.returncode != 0 or not CORE_GGUF.exists():
        raise RuntimeError("GGUF conversion failed")
    return CORE_GGUF


def ensure_core_modelfile(gguf: Path) -> Path:
    text = f"""# Copix Core — Qwen2.5-Coder QLoRA via GGUF
FROM {gguf.as_posix()}
TEMPLATE \"\"\"{QWEN_TEMPLATE}\"\"\"
PARAMETER temperature 0.15
PARAMETER top_p 0.9
PARAMETER num_ctx 4096
PARAMETER stop "<|im_start|>"
PARAMETER stop "<|im_end|>"
SYSTEM {SYSTEM}
"""
    CORE_MODELFILE.parent.mkdir(parents=True, exist_ok=True)
    CORE_MODELFILE.write_text(text, encoding="utf-8")
    return CORE_MODELFILE


def ensure_oss_modelfile() -> Path:
    text = f"""# Copix Core — gpt-oss-20b LoRA (≥14GB VRAM path)
FROM {OSS_MERGED.as_posix()}
PARAMETER temperature 0.2
PARAMETER top_p 0.9
PARAMETER num_ctx 8192
SYSTEM {SYSTEM}
"""
    OSS_MODELFILE.parent.mkdir(parents=True, exist_ok=True)
    OSS_MODELFILE.write_text(text, encoding="utf-8")
    return OSS_MODELFILE


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="copix-core", help="Ollama model name")
    args = ap.parse_args()

    if CORE_MERGED.exists():
        try:
            gguf = ensure_gguf()
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr, flush=True)
            sys.exit(1)
        mf = ensure_core_modelfile(gguf)
        code = create_from_modelfile(args.name, mf)
        if code != 0:
            sys.exit(code)
        print(f"\n✓ Ollama model '{args.name}' ready. Run: ollama run {args.name}", flush=True)
        return

    if OSS_MERGED.exists():
        mf = ensure_oss_modelfile()
        code = create_from_modelfile(args.name, mf)
        if code != 0:
            sys.exit(code)
        print(f"\n✓ Ollama model '{args.name}' ready (gpt-oss base). Run: ollama run {args.name}", flush=True)
        return

    print(
        "ERROR: No merged model found.\n"
        "  Train:  powershell -File train.ps1\n"
        "  Then:   py -3.11 export_ollama.py\n"
        f"  Expected: {CORE_MERGED}",
        file=sys.stderr,
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
