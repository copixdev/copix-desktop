#!/usr/bin/env python3
"""Copix Core inference server — OpenAI-compatible /v1/chat/completions"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "output"
ADAPTER_DIR = OUT_DIR / "copix-core-lora"
DEFAULT_BASE = "Qwen/Qwen2.5-Coder-1.5B-Instruct"


def load_model(base_model: str):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=dtype,
        device_map="auto" if torch.cuda.is_available() else None,
        trust_remote_code=True,
    )
    if (ADAPTER_DIR / "adapter_config.json").exists():
        model = PeftModel.from_pretrained(model, str(ADAPTER_DIR))
        print(f"Loaded LoRA adapter from {ADAPTER_DIR}", flush=True)
    else:
        print("No trained adapter found — using base model. Train first in Copix Studio.", flush=True)
    model.eval()
    return model, tokenizer


def build_prompt(messages: list) -> str:
    parts = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role == "system":
            parts.append(f"<|im_start|>system\n{content}\n")
        elif role == "user":
            parts.append(f"<|im_start|>user\n{content}\n")
        elif role == "assistant":
            parts.append(f"<|im_start|>assistant\n{content}\n")
    parts.append("<|im_start|>assistant\n")
    return "".join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--base-model", default=DEFAULT_BASE)
    args = ap.parse_args()

    try:
        from fastapi import FastAPI, Request
        from fastapi.responses import StreamingResponse, JSONResponse
        import uvicorn
    except ImportError:
        print("Install: pip install fastapi uvicorn", file=sys.stderr)
        sys.exit(1)

    print("Loading model…", flush=True)
    model, tokenizer = load_model(args.base_model)
    app = FastAPI()

    @app.get("/v1/models")
    def models():
        return {"data": [{"id": "copix-core"}, {"id": "copix-core-dev"}]}

    @app.get("/health")
    def health():
        return {"status": "ok", "adapter": (ADAPTER_DIR / "adapter_config.json").exists()}

    @app.post("/v1/chat/completions")
    async def chat(req: Request):
        body = await req.json()
        messages = body.get("messages", [])
        stream = body.get("stream", False)
        max_tokens = body.get("max_tokens", 512)
        prompt = build_prompt(messages)

        import torch
        inputs = tokenizer(prompt, return_tensors="pt")
        if torch.cuda.is_available():
            inputs = {k: v.to(model.device) for k, v in inputs.items()}

        if stream:
            def gen():
                with torch.no_grad():
                    for chunk in _stream_generate(model, tokenizer, inputs, max_tokens):
                        payload = {"choices": [{"delta": {"content": chunk}, "finish_reason": None}]}
                        yield f"data: {json.dumps(payload)}\n\n"
                yield "data: [DONE]\n\n"
            return StreamingResponse(gen(), media_type="text/event-stream")

        with torch.no_grad():
            out = model.generate(
                **inputs,
                max_new_tokens=max_tokens,
                do_sample=True,
                temperature=0.3,
                top_p=0.9,
                pad_token_id=tokenizer.eos_token_id,
            )
        text = tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
        return JSONResponse({
            "choices": [{"message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
        })

    print(f"Copix Core server http://{args.host}:{args.port}/v1", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


def _stream_generate(model, tokenizer, inputs, max_tokens):
    import torch
    input_ids = inputs["input_ids"]
    generated = input_ids
    for _ in range(max_tokens):
        with torch.no_grad():
            logits = model(input_ids=generated).logits[:, -1, :]
            next_id = torch.argmax(logits, dim=-1, keepdim=True)
        token = next_id[0, 0].item()
        if token == tokenizer.eos_token_id:
            break
        piece = tokenizer.decode([token], skip_special_tokens=True)
        if piece:
            yield piece
        generated = torch.cat([generated, next_id], dim=-1)
        time.sleep(0)  # yield to event loop


if __name__ == "__main__":
    main()
