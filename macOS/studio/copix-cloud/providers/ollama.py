"""Forward OpenAI-compatible requests to a remote Ollama instance."""

from __future__ import annotations

import json
from typing import AsyncIterator

import httpx


class OllamaProvider:
    def __init__(self, base_url: str, default_model: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.default_model = default_model

    async def health(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(f"{self.base_url}/api/tags")
                if not res.is_success:
                    return {"ok": False, "message": f"Ollama returned {res.status_code}"}
                data = res.json()
                names = [m.get("name", "") for m in data.get("models", [])]
                has_model = any(
                    n.startswith(self.default_model) or n.startswith(self.default_model.split(":")[0])
                    for n in names
                )
                if has_model:
                    return {"ok": True, "message": f"Ollama · {self.default_model} ready", "models": names}
                return {
                    "ok": False,
                    "message": f"Model {self.default_model} not found on Ollama backend",
                    "models": names,
                }
        except Exception as exc:
            return {"ok": False, "message": f"Cannot reach Ollama at {self.base_url}: {exc}"}

    async def chat_completions(self, body: dict) -> tuple[bool, AsyncIterator[bytes]]:
        payload = dict(body)
        payload.setdefault("model", self.default_model)
        stream = bool(payload.get("stream", False))
        url = f"{self.base_url}/v1/chat/completions"

        client = httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0))

        if stream:
            req = client.build_request("POST", url, json=payload)
            res = await client.send(req, stream=True)
            if not res.is_success:
                text = await res.aread()
                await client.aclose()

                async def err_once() -> AsyncIterator[bytes]:
                    yield text

                return False, err_once()

            async def stream_body() -> AsyncIterator[bytes]:
                try:
                    async for chunk in res.aiter_bytes():
                        yield chunk
                finally:
                    await res.aclose()
                    await client.aclose()

            return True, stream_body()

        res = await client.post(url, json=payload)
        data = res.content

        async def once() -> AsyncIterator[bytes]:
            yield data
            await client.aclose()

        return res.is_success, once()
