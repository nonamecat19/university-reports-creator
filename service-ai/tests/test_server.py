"""Servicer behaviour that does not need a live model: the kill switch, the
metadata contract, transform routing and the status snapshot."""

from __future__ import annotations

from collections.abc import AsyncIterator

import grpc
import pytest

from ai.config import AIConfig
from ai.providers import CompletionChunk, CompletionOptions, ProviderCapabilities
from ai.server import AIServicer


class Aborted(Exception):
    """What the fake context raises in place of gRPC's abort."""

    def __init__(self, code: grpc.StatusCode, details: str) -> None:
        super().__init__(details)
        self.code = code
        self.details = details


class FakeContext:
    """Minimal ServicerContext: records the prompt-independent inputs the
    servicer reads, and turns abort into a catchable exception."""

    def __init__(self, metadata: dict[str, str] | None = None, cancelled: bool = False) -> None:
        self._metadata = metadata if metadata is not None else {"x-user-id": "user-1"}
        self._cancelled = cancelled

    def invocation_metadata(self) -> list[tuple[str, str]]:
        return list(self._metadata.items())

    def cancelled(self) -> bool:
        return self._cancelled

    def abort(self, code: grpc.StatusCode, details: str) -> None:
        raise Aborted(code, details)


class FakeProvider:
    """Records the last prompt and options instead of calling a model."""

    name = "ollama"
    model = "gemma3:8b"

    def __init__(self) -> None:
        self.prompts: list[str] = []
        self.options: list[CompletionOptions] = []

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities()

    async def complete(self, messages, options=None) -> str:
        self.prompts.append(messages[-1]["content"])
        self.options.append(options)
        return ""

    async def stream(self, messages, options=None) -> AsyncIterator[CompletionChunk]:
        self.prompts.append(messages[-1]["content"])
        self.options.append(options)
        yield CompletionChunk(delta="продовження", done=False)
        yield CompletionChunk(delta="", done=True, prompt_tokens=10, completion_tokens=2)


def make_servicer(**overrides) -> tuple[AIServicer, FakeProvider]:
    config = AIConfig(languagetool_enabled=False, **overrides)
    provider = FakeProvider()
    return AIServicer(provider, config), provider


async def drain(stream) -> list:
    return [chunk async for chunk in stream]


class Request:
    """Stand-in for a protobuf request message: attribute access with the
    proto3 default for anything the caller did not set."""

    _DEFAULTS = {
        "text": "",
        "topic": "",
        "report_type": "",
        "section_title": "",
        "preceding_text": "",
        "target_language": "",
        "transform": 0,
        "max_tokens": 0,
    }

    def __init__(self, **fields) -> None:
        for key, default in self._DEFAULTS.items():
            setattr(self, key, fields.pop(key, default))
        for key, value in fields.items():
            setattr(self, key, value)


# ── Kill switch (AI_ENABLED) ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_disabled_service_refuses_transform():
    servicer, _ = make_servicer(ai_enabled=False)

    with pytest.raises(Aborted) as exc:
        await drain(
            servicer.TransformSelection(Request(text="текст", transform=1), FakeContext())
        )
    assert exc.value.code == grpc.StatusCode.FAILED_PRECONDITION


@pytest.mark.asyncio
async def test_disabled_service_still_reports_status():
    """GetAIStatus is what the client asks to find out it is disabled, so it
    must answer even then."""
    servicer, _ = make_servicer(ai_enabled=False)

    status = await servicer.GetAIStatus(Request(), FakeContext())
    assert status.enabled is False


# ── Metadata contract (FR-ARC-15) ────────────────────────────────────


@pytest.mark.asyncio
async def test_user_id_read_from_gateway_metadata_key():
    """The gateway injects x-user-id; reading any other key would rate-limit
    every caller as one anonymous user — or reject them all."""
    servicer, _ = make_servicer()

    chunks = await drain(
        servicer.ContinueWriting(
            Request(preceding_text="Вступ."),
            FakeContext({"x-user-id": "user-42"}),
        )
    )
    assert [c.delta for c in chunks] == ["продовження", ""]


@pytest.mark.asyncio
async def test_missing_user_id_is_unauthenticated():
    servicer, _ = make_servicer()

    with pytest.raises(Aborted) as exc:
        await drain(servicer.ContinueWriting(Request(preceding_text="Вступ."), FakeContext({})))
    assert exc.value.code == grpc.StatusCode.UNAUTHENTICATED


# ── TransformSelection ───────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("transform", "marker"),
    [(1, "Переформулюй"), (2, "Розгорни"), (3, "Стисни"), (5, "академічн")],
)
async def test_transform_kind_picks_its_instruction(transform, marker):
    servicer, provider = make_servicer()

    await drain(servicer.TransformSelection(Request(text="текст", transform=transform), FakeContext()))

    assert marker.lower() in provider.prompts[0].lower()


@pytest.mark.asyncio
async def test_translate_uses_target_language():
    servicer, provider = make_servicer()

    await drain(
        servicer.TransformSelection(
            Request(text="текст", transform=4, target_language="en"), FakeContext()
        )
    )
    await drain(
        servicer.TransformSelection(
            Request(text="text", transform=4, target_language="uk"), FakeContext()
        )
    )

    assert "into English" in provider.prompts[0]
    assert "українською" in provider.prompts[1]


@pytest.mark.asyncio
async def test_unsupported_target_language_is_rejected():
    servicer, _ = make_servicer()

    with pytest.raises(Aborted) as exc:
        await drain(
            servicer.TransformSelection(
                Request(text="текст", transform=4, target_language="zz"), FakeContext()
            )
        )
    assert exc.value.code == grpc.StatusCode.INVALID_ARGUMENT


@pytest.mark.asyncio
async def test_unknown_transform_is_rejected():
    servicer, _ = make_servicer()

    with pytest.raises(Aborted) as exc:
        await drain(servicer.TransformSelection(Request(text="текст", transform=99), FakeContext()))
    assert exc.value.code == grpc.StatusCode.INVALID_ARGUMENT


@pytest.mark.asyncio
async def test_empty_selection_is_rejected():
    servicer, _ = make_servicer()

    with pytest.raises(Aborted) as exc:
        await drain(servicer.TransformSelection(Request(text="   ", transform=1), FakeContext()))
    assert exc.value.code == grpc.StatusCode.INVALID_ARGUMENT


@pytest.mark.asyncio
async def test_expand_gets_more_headroom_than_condense():
    servicer, provider = make_servicer()
    text = "речення " * 100

    await drain(servicer.TransformSelection(Request(text=text, transform=2), FakeContext()))
    await drain(servicer.TransformSelection(Request(text=text, transform=3), FakeContext()))

    assert provider.options[0].max_tokens > provider.options[1].max_tokens


@pytest.mark.asyncio
async def test_token_budget_never_exceeds_configured_maximum():
    servicer, provider = make_servicer(max_tokens_default=300)

    await drain(servicer.TransformSelection(Request(text="слово " * 500, transform=2), FakeContext()))

    assert provider.options[0].max_tokens == 300


# ── ContinueWriting ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_only_the_tail_of_the_context_is_sent():
    """Sending the whole section would blow the context budget (FR-AI-02)."""
    servicer, provider = make_servicer()
    preceding = "А" * 9000

    await drain(servicer.ContinueWriting(Request(preceding_text=preceding), FakeContext()))

    from ai.server import CONTINUATION_CONTEXT_CHARS

    assert provider.prompts[0].count("А") == CONTINUATION_CONTEXT_CHARS


@pytest.mark.asyncio
async def test_empty_preceding_text_is_rejected():
    servicer, _ = make_servicer()

    with pytest.raises(Aborted) as exc:
        await drain(servicer.ContinueWriting(Request(preceding_text="  "), FakeContext()))
    assert exc.value.code == grpc.StatusCode.INVALID_ARGUMENT


@pytest.mark.asyncio
async def test_continuation_uses_default_token_budget_when_unset():
    servicer, provider = make_servicer()

    await drain(servicer.ContinueWriting(Request(preceding_text="Вступ."), FakeContext()))

    from ai.server import DEFAULT_CONTINUATION_TOKENS

    assert provider.options[0].max_tokens == DEFAULT_CONTINUATION_TOKENS


@pytest.mark.asyncio
async def test_cancelled_call_stops_streaming():
    servicer, _ = make_servicer()

    chunks = await drain(
        servicer.ContinueWriting(
            Request(preceding_text="Вступ."), FakeContext(cancelled=True)
        )
    )
    assert chunks == []


# ── Rate limiting (FR-AI-05) ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_per_minute_limit_is_enforced():
    servicer, _ = make_servicer(max_requests_per_minute=1)

    await drain(servicer.ContinueWriting(Request(preceding_text="Вступ."), FakeContext()))
    with pytest.raises(Aborted) as exc:
        await drain(servicer.ContinueWriting(Request(preceding_text="Вступ."), FakeContext()))
    assert exc.value.code == grpc.StatusCode.RESOURCE_EXHAUSTED


@pytest.mark.asyncio
async def test_limits_are_per_user():
    servicer, _ = make_servicer(max_requests_per_minute=1)

    await drain(
        servicer.ContinueWriting(Request(preceding_text="Вступ."), FakeContext({"x-user-id": "a"}))
    )
    chunks = await drain(
        servicer.ContinueWriting(Request(preceding_text="Вступ."), FakeContext({"x-user-id": "b"}))
    )
    assert chunks


# ── GetAIStatus (FR-AI-04/05) ────────────────────────────────────────


@pytest.mark.asyncio
async def test_status_reports_local_provider_and_limits():
    servicer, _ = make_servicer(max_concurrent_per_user=3, max_requests_per_minute=7)

    status = await servicer.GetAIStatus(Request(), FakeContext())

    assert status.enabled is True
    assert status.provider == "ollama"
    assert status.local_provider is True  # no cloud-consent notice needed
    assert status.grammar_available is False  # languagetool_enabled=False
    assert status.max_concurrent_per_user == 3
    assert status.max_requests_per_minute == 7


@pytest.mark.asyncio
async def test_cloud_provider_is_not_reported_as_local():
    servicer, provider = make_servicer()
    provider.name = "openai"

    status = await servicer.GetAIStatus(Request(), FakeContext())
    assert status.local_provider is False
