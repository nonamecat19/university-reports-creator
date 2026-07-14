---
name: service-ai-provider
description: "Python service-ai patterns for this project. Use when adding/modifying LLM providers, gRPC servicer methods, prompts, rate limiting, or config in service-ai/src/ai. Covers the exact LLMProvider abstraction, streaming/unary RPC method pattern, per-user rate limiting, and provider factory used by service-ai."
---

# Service-AI Provider Patterns

Architecture and coding patterns for `service-ai` (Python 3.12, gRPC, async). Follow these exactly when touching `service-ai/src/ai/`.

## Layout

```
service-ai/src/ai/
  __main__.py          # entry point, generate_proto_stubs()
  server.py             # AIServicer — implements the AIService gRPC interface
  config.py              # AIConfig (pydantic-settings, env-driven)
  ratelimit.py            # RateLimiter — per-user concurrent + per-minute
  grammar.py               # LanguageToolChecker (tier-1 grammar)
  prompts/                  # prompt templates + format_prompt()
  providers/
    __init__.py            # LLMProvider ABC, CompletionOptions/Chunk, create_provider()
    ollama_provider.py
    openai_provider.py
    anthropic_provider.py
    openrouter_provider.py
  proto/                    # generated pb2/pb2_grpc (regenerate via `make build-ai`)
```

## Provider Abstraction (`providers/__init__.py`)

Every provider implements the `LLMProvider` ABC:

```python
class LLMProvider(abc.ABC):
    @abc.abstractmethod
    async def complete(self, messages: list[dict[str, str]], options: CompletionOptions | None = None) -> str: ...

    @abc.abstractmethod
    async def stream(self, messages: list[dict[str, str]], options: CompletionOptions | None = None) -> AsyncIterator[CompletionChunk]: ...

    @abc.abstractmethod
    def capabilities(self) -> ProviderCapabilities: ...

    @property
    @abc.abstractmethod
    def name(self) -> str: ...

    @property
    @abc.abstractmethod
    def model(self) -> str: ...
```

`messages` is always `list[dict[str, str]]` with `role`/`content` keys (OpenAI-style), regardless of the target API's native shape — each provider translates internally (e.g. `AnthropicProvider` pulls `system_prompt` out of `options` into a top-level `system` field since Anthropic doesn't accept it as a message).

### Adding a New Provider

1. Create `providers/<name>_provider.py`, subclass `LLMProvider`, implement all five members above.
2. Own an `httpx.AsyncClient` (or SDK client) as `self._client`, constructed in `__init__(self, model: str, api_key: str = "", base_url: str = "...", **_kwargs: str)` — the factory always calls providers with keyword args, so accept `**_kwargs` for forward compat.
3. Report accurate `ProviderCapabilities` (`max_context_tokens`, `supports_json_mode`, `supports_streaming`, `supports_system_prompt`) — callers branch on these.
4. Register it in `create_provider()`'s `providers` dict in `providers/__init__.py`.
5. Add its config fields (`<name>_api_key`, `<name>_base_url`) to `config.py` and to `.env.example`.

### complete() / stream() Pattern

```python
async def complete(self, messages, options=None) -> str:
    opts = options or CompletionOptions()
    payload = {"model": self._model, "max_tokens": opts.max_tokens, "messages": messages}
    if opts.system_prompt:
        payload["system"] = opts.system_prompt
    resp = await self._client.post("/v1/messages", json=payload)
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]

async def stream(self, messages, options=None) -> AsyncIterator[CompletionChunk]:
    ...
    async with self._client.stream("POST", "/v1/messages", json=payload) as resp:
        resp.raise_for_status()
        async for line in resp.aiter_lines():
            if not line.startswith("data: "):
                continue
            data = json.loads(line[6:])
            if data.get("type") == "content_block_delta":
                yield CompletionChunk(delta=data["delta"].get("text", ""))
            elif data.get("type") == "message_stop":
                yield CompletionChunk(done=True)
                break
```

`stream()` must always terminate with a `CompletionChunk(done=True)` — `AIServicer` and the Angular client both key end-of-stream off `chunk.done`, not stream closure.

## Config (`config.py`)

`pydantic_settings.BaseSettings` subclass, one flat class, fields map directly to env vars (no prefix: `model_config = {"env_prefix": "", "extra": "ignore"}`). `ai_provider: Literal["ollama", "openai", "anthropic", "openrouter"]` selects the provider; `ai_fallback_provider` is reserved for failover (not yet wired). Add new tunables here, not as magic numbers in `server.py`.

## gRPC Servicer Pattern (`server.py`)

`AIServicer` holds one `LLMProvider` instance (chosen once at startup by `create_provider(config.ai_provider, config.ai_model, ...)`), a `RateLimiter`, and an optional `LanguageToolChecker`. Every RPC method follows the same shape:

```python
async def SomeMethod(self, request, context):
    user_id = self._get_user_id(context)                 # aborts UNAUTHENTICATED if missing
    if not await self._rate_limiter.acquire(user_id):
        context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "rate limit exceeded")
    try:
        # build CompletionOptions + messages, call self._provider.complete/stream
        # for server-streaming methods: `if context.cancelled(): break` inside the loop
        ...
    finally:
        await self._rate_limiter.release(user_id)
```

Rules:
- **Always** `acquire()` before work and `release()` in a `finally` — never on the happy path only, cancellation and exceptions must still release the slot.
- **Always** check `context.cancelled()` inside streaming loops before yielding, so client-side cancel (e.g. Angular's `AbortController`) actually stops upstream LLM work instead of burning tokens.
- Import generated proto message types (`from ai.proto.ai_pb2 import ...`) inside the method, not at module top — keeps `server.py` importable before `make build-ai` has generated stubs.
- JSON-mode LLM responses (`json_mode=True`) are parsed defensively — wrap in `try/except json.JSONDecodeError` and fall back to a single low-confidence finding/empty result, never let a malformed LLM response 500 the RPC.
- `_get_user_id()` reads `user-id` from `context.invocation_metadata()` — this is injected by service-gateway after JWT verification; service-ai itself does not verify the JWT.
- Default `system_prompt` for user-facing generation is `ACADEMIC_UKRAINIAN_SYSTEM` from `ai/prompts` — pass it explicitly unless the caller supplied its own.
- Never log request/response content (`FR-AI-04`, privacy) — `config.log_content` gates this; log only lengths/latency/model as in the existing `logger.info(...)` calls.

## Rate Limiting (`ratelimit.py`)

Per-user sliding-window limiter, in-memory (`defaultdict` + `asyncio.Lock`), two independent caps: `max_concurrent` (in-flight requests) and `max_per_minute` (sliding 60s window, pruned on each `acquire`). Not distributed — fine for a single service-ai instance; if service-ai is ever scaled horizontally this needs to move to Redis or similar.

## Two-Tier Grammar Checking

`CorrectGrammar` runs LanguageTool (tier 1, rule-based, only for `uk`/unset language) first, yielding one `GrammarSuggestion` per match with `tier=GRAMMAR_TIER_LANGUAGE_TOOL`, then — if `request.include_style` — an LLM style pass (tier 2) with `tier=GRAMMAR_TIER_LLM_STYLE`. Keep both tiers independently yieldable (client renders them the same way but may filter by tier) rather than merging into one call.

## Testing

`service-ai/tests/` + `make test-python` (`uv run pytest`). When adding a provider or servicer method, mock the `httpx.AsyncClient`/`LLMProvider` rather than hitting real provider APIs.
