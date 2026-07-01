"""service-ai configuration (FR-AI-01)."""

from __future__ import annotations

from typing import Literal

from pydantic_settings import BaseSettings


class AIConfig(BaseSettings):
    """Service-ai configuration loaded from environment variables."""

    # Server
    port: int = 50055
    max_workers: int = 10
    log_level: str = "INFO"
    json_logging: bool = False

    # Provider selection (FR-AI-01)
    ai_provider: Literal["ollama", "openai", "anthropic", "openrouter"] = "ollama"
    ai_model: str = "gemma3:8b"
    ai_fallback_provider: str = ""

    # Ollama
    ollama_base_url: str = "http://localhost:11434"

    # OpenAI / OpenRouter
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    # Anthropic
    anthropic_api_key: str = ""
    anthropic_base_url: str = "https://api.anthropic.com"

    # Limits (FR-AI-05)
    max_concurrent_per_user: int = 2
    max_requests_per_minute: int = 20
    max_tokens_default: int = 4096
    temperature_default: float = 0.7

    # LanguageTool (FR-AI-11)
    languagetool_url: str = "http://localhost:8010"
    languagetool_enabled: bool = True

    # Privacy (FR-AI-04)
    log_content: bool = False  # Never log document content; only sizes/latency/model

    model_config = {"env_prefix": "", "extra": "ignore"}
