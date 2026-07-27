"""
Copix Cloud — lightweight OpenAI-compatible proxy for Copix Studio.

Auth: Bearer COPIX_API_KEY on all /v1/* routes.
Backend: Ollama (recommended) or Hugging Face Inference via env.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict
from typing import AsyncIterator

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from providers import HuggingFaceProvider, OllamaProvider

load_dotenv()

COPIX_API_KEY = os.getenv("COPIX_API_KEY", "").strip()
BACKEND = os.getenv("BACKEND", "ollama").strip().lower()
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "gpt-oss:20b")
HF_MODEL = os.getenv("HF_MODEL", "openai/gpt-oss-20b")
HF_TOKEN = os.getenv("HF_TOKEN", "").strip()
RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "30"))
PORT = int(os.getenv("PORT", "8080"))

# Simple per-IP sliding window rate limit (fine for single-instance free tier).
_hits: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(client_ip: str) -> None:
    now = time.time()
    window = _hits[client_ip]
    window[:] = [t for t in window if now - t < 60]
    if len(window) >= RATE_LIMIT_PER_MIN:
        raise HTTPException(status_code=429, detail="Rate limit exceeded — try again in a minute")
    window.append(now)


def _require_auth(authorization: str | None) -> None:
    if not COPIX_API_KEY:
        raise HTTPException(status_code=503, detail="Server misconfigured: COPIX_API_KEY not set")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization[7:].strip()
    if token != COPIX_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")


def _provider():
    if BACKEND == "huggingface":
        return HuggingFaceProvider(HF_MODEL, HF_TOKEN)
    return OllamaProvider(OLLAMA_URL, DEFAULT_MODEL)


app = FastAPI(title="Copix Cloud", version="0.1.0")


class HealthResponse(BaseModel):
    status: str
    backend: str
    model: str
    backend_health: dict


@app.get("/health")
async def health() -> HealthResponse:
    prov = _provider()
    bh = await prov.health()
    return HealthResponse(
        status="ok" if bh.get("ok") else "degraded",
        backend=BACKEND,
        model=HF_MODEL if BACKEND == "huggingface" else DEFAULT_MODEL,
        backend_health=bh,
    )


@app.get("/")
async def root():
    return {"service": "copix-cloud", "docs": "/docs", "health": "/health"}


@app.get("/v1/models")
async def list_models(authorization: str | None = Header(None)):
    _require_auth(authorization)
    model = HF_MODEL if BACKEND == "huggingface" else DEFAULT_MODEL
    return {
        "object": "list",
        "data": [{"id": model, "object": "model", "owned_by": "copix"}],
    }


@app.post("/v1/chat/completions")
async def chat_completions(request: Request, authorization: str | None = Header(None)):
    _require_auth(authorization)
    _check_rate_limit(request.client.host if request.client else "unknown")

    body = await request.json()
    prov = _provider()
    ok, stream = await prov.chat_completions(body)

    if body.get("stream"):
        return StreamingResponse(
            stream,
            media_type="text/event-stream",
            status_code=200 if ok else 502,
        )

    chunks: list[bytes] = []
    async for c in stream:
        chunks.append(c)
    data = b"".join(chunks)
    if not ok:
        return JSONResponse(content={"error": data.decode(errors="replace")}, status_code=502)
    import json

    return JSONResponse(content=json.loads(data))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
