"""LanguageTool integration for tier-1 grammar checking (FR-AI-11)."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


@dataclass
class GrammarMatch:
    """A single grammar match from LanguageTool."""

    offset: int
    length: int
    message: str
    rule_id: str
    replacements: list[str]
    context: str


class LanguageToolChecker:
    """LanguageTool HTTP API client for Ukrainian grammar checking."""

    def __init__(self, base_url: str = "http://localhost:8010", language: str = "uk") -> None:
        self._base_url = base_url.rstrip("/")
        self._language = language
        self._client = httpx.AsyncClient(timeout=30.0)

    async def check(self, text: str) -> list[GrammarMatch]:
        """Check text against LanguageTool rules."""
        try:
            resp = await self._client.post(
                f"{self._base_url}/v2/check",
                data={"text": text, "language": self._language},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
            data = resp.json()

            matches = []
            for m in data.get("matches", []):
                replacements = [r["value"] for r in m.get("replacements", [])[:5]]
                context_text = m.get("context", {}).get("text", "")
                matches.append(
                    GrammarMatch(
                        offset=m["offset"],
                        length=m["length"],
                        message=m.get("message", ""),
                        rule_id=m.get("rule", {}).get("id", ""),
                        replacements=replacements,
                        context=context_text,
                    )
                )
            return matches
        except Exception:
            logger.warning("LanguageTool check failed", exc_info=True)
            return []

    async def close(self) -> None:
        await self._client.aclose()
