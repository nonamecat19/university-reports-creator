"""OpenRouter provider — wraps OpenAI-compatible API (FR-AI-01)."""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

import httpx

from ai.providers import CompletionChunk, CompletionOptions, LLMProvider, ProviderCapabilities

logger = logging.getLogger(__name__)


class OpenRouterProvider(LLMProvider):
    """OpenRouter API provider (OpenAI-compatible)."""

    def __init__(
        self,
        model: str = "google/gemma-3-8b-it:free",
        api_key: str = "",
        base_url: str = "https://openrouter.ai/api/v1",
        **_kwargs: str,
    ) -> None:
        self._model = model
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=120.0,
            headers={
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": "https://university-reports-creator.local",
                "X-Title": "University Reports Creator",
            },
        )

    @property
    def name(self) -> str:
        return "openrouter"

    @property
    def model(self) -> str:
        return self._model

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            max_context_tokens=128000,
            supports_json_mode=True,
            supports_streaming=True,
            supports_system_prompt=True,
        )

    async def complete(
        self,
        messages: list[dict[str, str]],
        options: CompletionOptions | None = None,
    ) -> str:
        opts = options or CompletionOptions()
        payload: dict = {
            "model": self._model,
            "messages": messages,
            "temperature": opts.temperature,
            "max_tokens": opts.max_tokens,
        }
        if opts.json_mode:
            payload["response_format"] = {"type": "json_object"}
        if opts.system_prompt:
            messages = [{"role": "system", "content": opts.system_prompt}] + messages
            payload["messages"] = messages

        resp = await self._client.post("/chat/completions", json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]

    async def stream(
        self,
        messages: list[dict[str, str]],
        options: CompletionOptions | None = None,
    ) -> AsyncIterator[CompletionChunk]:
        opts = options or CompletionOptions()
        payload: dict = {
            "model": self._model,
            "messages": messages,
            "temperature": opts.temperature,
            "max_tokens": opts.max_tokens,
            "stream": True,
        }
        if opts.json_mode:
            payload["response_format"] = {"type": "json_object"}
        if opts.system_prompt:
            messages = [{"role": "system", "content": opts.system_prompt}] + messages
            payload["messages"] = messages

        async with self._client.stream("POST", "/chat/completions", json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw.strip() == "[DONE]":
                    yield CompletionChunk(done=True)
                    break
                data = json.loads(raw)
                delta = data["choices"][0].get("delta", {})
                content = delta.get("content", "")
                if content:
                    yield CompletionChunk(delta=content)

    async def close(self) -> None:
        await self._client.aclose()
