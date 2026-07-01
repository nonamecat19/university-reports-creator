"""Anthropic provider (FR-AI-01)."""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

import httpx

from ai.providers import CompletionChunk, CompletionOptions, LLMProvider, ProviderCapabilities

logger = logging.getLogger(__name__)


class AnthropicProvider(LLMProvider):
    """Anthropic Messages API provider."""

    def __init__(
        self,
        model: str = "claude-sonnet-4-20250514",
        api_key: str = "",
        base_url: str = "https://api.anthropic.com",
        **_kwargs: str,
    ) -> None:
        self._model = model
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=120.0,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
        )

    @property
    def name(self) -> str:
        return "anthropic"

    @property
    def model(self) -> str:
        return self._model

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            max_context_tokens=200000,
            supports_json_mode=False,
            supports_streaming=True,
            supports_system_prompt=True,
        )

    async def complete(
        self,
        messages: list[dict[str, str]],
        options: CompletionOptions | None = None,
    ) -> str:
        opts = options or CompletionOptions()
        system = opts.system_prompt
        payload: dict = {
            "model": self._model,
            "max_tokens": opts.max_tokens,
            "messages": messages,
        }
        if system:
            payload["system"] = system

        resp = await self._client.post("/v1/messages", json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data["content"][0]["text"]

    async def stream(
        self,
        messages: list[dict[str, str]],
        options: CompletionOptions | None = None,
    ) -> AsyncIterator[CompletionChunk]:
        opts = options or CompletionOptions()
        system = opts.system_prompt
        payload: dict = {
            "model": self._model,
            "max_tokens": opts.max_tokens,
            "messages": messages,
            "stream": True,
        }
        if system:
            payload["system"] = system

        async with self._client.stream("POST", "/v1/messages", json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = json.loads(line[6:])
                event_type = data.get("type", "")
                if event_type == "content_block_delta":
                    delta = data.get("delta", {})
                    text = delta.get("text", "")
                    if text:
                        yield CompletionChunk(delta=text)
                elif event_type == "message_stop":
                    yield CompletionChunk(done=True)
                    break

    async def close(self) -> None:
        await self._client.aclose()
