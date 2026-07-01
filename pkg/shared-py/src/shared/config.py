"""Environment configuration loader using pydantic-settings."""

from __future__ import annotations

from functools import lru_cache
from typing import TypeVar

from pydantic_settings import BaseSettings, SettingsConfigDict

T = TypeVar("T", bound=BaseSettings)


def load_config(cls: type[T], env_file: str = ".env") -> T:
    """Load configuration from environment variables and optional .env file."""
    model = cls  # type: ignore[assignment]
    model.model_config = SettingsConfigDict(  # type: ignore[attr-defined]
        env_file=env_file,
        env_file_encoding="utf-8",
        extra="ignore",
    )
    return model()  # type: ignore[call-arg]


@lru_cache
def get_config(cls: type[T], env_file: str = ".env") -> T:
    """Cached version of load_config."""
    return load_config(cls, env_file)
