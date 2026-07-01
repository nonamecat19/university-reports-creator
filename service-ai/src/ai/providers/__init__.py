"""AI Provider abstraction layer (FR-AI-01).

Internal LLMProvider interface:
  - complete(messages, options) -> str
  - stream(messages, options) -> AsyncIterator[str]
  - capabilities() -> ProviderCapabilities
"""

from __future__ import annotations

import abc
import logging
from dataclasses import dataclass, field
from typing import AsyncIterator

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProviderCapabilities:
    """Capabilities reported by a provider (FR-AI-01)."""

    max_context_tokens: int = 8192
    supports_json_mode: bool = False
    supports_streaming: bool = True
    supports_system_prompt: bool = True


@dataclass
class CompletionOptions:
    """Options for a completion request."""

    temperature: float = 0.7
    max_tokens: int = 4096
    json_mode: bool = False
    json_schema: str = ""
    system_prompt: str = ""


@dataclass
class CompletionChunk:
    """A single streaming chunk."""

    delta: str = ""
    done: bool = False
    prompt_tokens: int = 0
    completion_tokens: int = 0


class LLMProvider(abc.ABC):
    """Abstract base for all LLM provider implementations."""

    @abc.abstractmethod
    async def complete(
        self,
        messages: list[dict[str, str]],
        options: CompletionOptions | None = None,
    ) -> str:
        """Single-turn completion returning the full response text."""
        ...

    @abc.abstractmethod
    async def stream(
        self,
        messages: list[dict[str, str]],
        options: CompletionOptions | None = None,
    ) -> AsyncIterator[CompletionChunk]:
        """Streaming completion yielding incremental chunks."""
        ...
        # Make this a proper async generator
        yield  # type: ignore[misc]

    @abc.abstractmethod
    def capabilities(self) -> ProviderCapabilities:
        """Report provider capabilities."""
        ...

    @property
    @abc.abstractmethod
    def name(self) -> str:
        """Provider name for logging/metadata."""
        ...

    @property
    @abc.abstractmethod
    def model(self) -> str:
        """Model name for logging/metadata."""
        ...


def create_provider(provider_type: str, model: str, **kwargs: str) -> LLMProvider:
    """Factory to create the appropriate provider (FR-AI-01)."""
    from ai.providers.ollama_provider import OllamaProvider
    from ai.providers.openai_provider import OpenAIProvider
    from ai.providers.anthropic_provider import AnthropicProvider
    from ai.providers.openrouter_provider import OpenRouterProvider

    providers = {
        "ollama": OllamaProvider,
        "openai": OpenAIProvider,
        "anthropic": AnthropicProvider,
        "openrouter": OpenRouterProvider,
    }

    cls = providers.get(provider_type)
    if cls is None:
        raise ValueError(f"Unknown AI provider: {provider_type}")

    logger.info("Creating provider: %s (model: %s)", provider_type, model)
    return cls(model=model, **kwargs)  # type: ignore[call-arg]
