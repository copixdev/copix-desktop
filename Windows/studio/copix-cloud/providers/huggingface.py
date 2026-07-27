"""Hugging Face Inference API — serverless gpt-oss (no tool streaming parity with Ollama)."""

from __future__ import annotations

import json
from typing import AsyncIterator

import httpx


class HuggingFaceProvider:
    """Uses HF router OpenAI-compatible endpoint when HF_TOKEN is set."""

    def __init__(self, model_id: str, token: str) -> None:
        self.model_id = model_id
        self.token = token
        self.base_url = "https://router.huggingface.co/v1"

    async def health(self) -> dict:
        if not self.token:
            return {"ok": False, "message": "HF_TOKEN not configured on server"}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(
                    f"{self.base_url}/models",
                    headers={"Authorization": f"Bearer {self.token}"},
                )
                if res.is_success:
                    return {"ok": True, "message": f"HF router · {self.model_id}"}
                return {"ok": False, "message": f"HF API {res.status_code}: {res.text[:200]}"}
        except Exception as exc:
            return {"ok": False, "message": f"HF unreachable: {exc}"}

    async def chat_completions(self, body: dict) -> tuple[bool, AsyncIterator[bytes]]:
        payload = dict(body)
        payload["model"] = self.model_id
        stream = bool(payload.get("stream", False))
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

        client = httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0))

        if stream:
            req = client.build_request("POST", url, headers=headers, json=payload)
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

        res = await client.post(url, headers=headers, json=payload)
        data = res.content

        async def once() -> AsyncIterator[bytes]:
            yield data
            await client.aclose()

        return res.is_success, once()
