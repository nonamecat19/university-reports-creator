"""Ollama provider — local-first default (FR-AI-01)."""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

import httpx

from ai.providers import CompletionChunk, CompletionOptions, LLMProvider, ProviderCapabilities

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "http://localhost:11434"


class OllamaProvider(LLMProvider):
    """Ollama HTTP API provider."""

    def __init__(self, model: str = "gemma3:8b", base_url: str = DEFAULT_BASE_URL, **_kwargs: str) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(base_url=self._base_url, timeout=120.0)

    @property
    def name(self) -> str:
        return "ollama"

    @property
    def model(self) -> str:
        return self._model

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            max_context_tokens=8192,
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
            "stream": False,
            "options": {
                "temperature": opts.temperature,
                "num_predict": opts.max_tokens,
            },
        }
        if opts.json_mode:
            payload["format"] = "json"
        if opts.system_prompt:
            messages = [{"role": "system", "content": opts.system_prompt}] + messages
            payload["messages"] = messages

        logger.info("Ollama complete: model=%s, msgs=%d", self._model, len(messages))
        resp = await self._client.post("/api/chat", json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data["message"]["content"]

    async def stream(
        self,
        messages: list[dict[str, str]],
        options: CompletionOptions | None = None,
    ) -> AsyncIterator[CompletionChunk]:
        opts = options or CompletionOptions()
        payload: dict = {
            "model": self._model,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": opts.temperature,
                "num_predict": opts.max_tokens,
            },
        }
        if opts.json_mode:
            payload["format"] = "json"
        if opts.system_prompt:
            messages = [{"role": "system", "content": opts.system_prompt}] + messages
            payload["messages"] = messages

        logger.info("Ollama stream: model=%s, msgs=%d", self._model, len(messages))
        async with self._client.stream("POST", "/api/chat", json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                data = json.loads(line)
                done = data.get("done", False)
                delta = data.get("message", {}).get("content", "")
                yield CompletionChunk(
                    delta=delta,
                    done=done,
                    prompt_tokens=data.get("prompt_eval_count", 0),
                    completion_tokens=data.get("eval_count", 0),
                )
                if done:
                    break

    async def close(self) -> None:
        await self._client.aclose()
