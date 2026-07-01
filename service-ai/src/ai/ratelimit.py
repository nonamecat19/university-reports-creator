"""Per-user rate limiting (FR-AI-05)."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from dataclasses import dataclass, field


@dataclass
class UserRateLimit:
    """Tracks concurrent and per-minute request counts for a single user."""

    concurrent: int = 0
    minute_requests: list[float] = field(default_factory=list)


class RateLimiter:
    """Per-user concurrent + per-minute rate limiter (FR-AI-05)."""

    def __init__(self, max_concurrent: int = 2, max_per_minute: int = 20) -> None:
        self.max_concurrent = max_concurrent
        self.max_per_minute = max_per_minute
        self._users: dict[str, UserRateLimit] = defaultdict(UserRateLimit)
        self._lock = asyncio.Lock()

    async def acquire(self, user_id: str) -> bool:
        """Try to acquire a slot. Returns False if rate-limited."""
        async with self._lock:
            limit = self._users[user_id]
            now = time.monotonic()

            # Prune old requests (>60s)
            limit.minute_requests = [t for t in limit.minute_requests if now - t < 60]

            if limit.concurrent >= self.max_concurrent:
                return False
            if len(limit.minute_requests) >= self.max_per_minute:
                return False

            limit.concurrent += 1
            limit.minute_requests.append(now)
            return True

    async def release(self, user_id: str) -> None:
        """Release a concurrent slot."""
        async with self._lock:
            limit = self._users[user_id]
            if limit.concurrent > 0:
                limit.concurrent -= 1
