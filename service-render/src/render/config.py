"""service-render configuration (FR-ARC-03)."""

from __future__ import annotations

from pydantic_settings import BaseSettings


class RenderConfig(BaseSettings):
    """Service-render configuration loaded from environment variables."""

    port: int = 50054
    max_workers: int = 10
    log_level: str = "INFO"
    json_logging: bool = False

    # NFR-09: zip-bomb guard for uploaded docx templates.
    max_decompressed_bytes: int = 300 * 1024 * 1024

    libreoffice_bin: str = "soffice"
    libreoffice_timeout_seconds: int = 60

    model_config = {"env_prefix": "", "extra": "ignore"}
