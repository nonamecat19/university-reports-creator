"""gRPC server for service-ai (FR-AI-01..15)."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import grpc

from ai.config import AIConfig
from ai.grammar import LanguageToolChecker
from ai.prompts import (
    ACADEMIC_UKRAINIAN_SYSTEM,
    ANALYZE_DOCUMENT,
    CITATION_CHECK,
    CONTINUE_WRITING,
    DRAFT_SECTION,
    FREEFORM_PARSE,
    GRAMMAR_CHECK,
    SOURCE_SUGGESTIONS,
    TRANSFORM_INSTRUCTIONS,
    TRANSFORM_SELECTION,
    TRANSLATE_INSTRUCTIONS,
    format_prompt,
)
from ai.providers import CompletionOptions, LLMProvider
from ai.ratelimit import RateLimiter

logger = logging.getLogger(__name__)

# Providers that run on our own hardware: with these, document text never
# leaves the machine/cluster, so no cloud-consent notice is needed (FR-AI-04).
LOCAL_PROVIDERS = frozenset({"ollama"})

# How much text before the cursor is sent as continuation context. Long enough
# to establish voice and subject, short enough to stay well inside a local
# model's context window (FR-AI-02).
CONTINUATION_CONTEXT_CHARS = 4000
DEFAULT_CONTINUATION_TOKENS = 512


class AIServicer:
    """Implements the AIService gRPC interface."""

    def __init__(
        self,
        provider: LLMProvider,
        config: AIConfig,
    ) -> None:
        self._provider = provider
        self._config = config
        self._rate_limiter = RateLimiter(
            max_concurrent=config.max_concurrent_per_user,
            max_per_minute=config.max_requests_per_minute,
        )
        self._grammar_checker: LanguageToolChecker | None = None
        if config.languagetool_enabled:
            self._grammar_checker = LanguageToolChecker(base_url=config.languagetool_url)

    # ── Ping ─────────────────────────────────────────────────────────

    async def Ping(self, request: Any, context: grpc.ServicerContext) -> Any:
        from ai.proto.ai_pb2 import PingResponse

        caps = self._provider.capabilities()
        logger.info("Ping: provider=%s, model=%s", self._provider.name, self._provider.model)
        return PingResponse(
            status="ok",
            provider=self._provider.name,
            model=self._provider.model,
        )

    # ── GenerateText (unary) ─────────────────────────────────────────

    async def GenerateText(self, request: Any, context: grpc.ServicerContext) -> Any:
        from ai.proto.ai_pb2 import GenerateTextResponse

        self._require_enabled(context)
        user_id = self._get_user_id(context)
        if not await self._rate_limiter.acquire(user_id):
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "rate limit exceeded")
        try:
            options = CompletionOptions(
                temperature=request.temperature or self._config.temperature_default,
                max_tokens=request.max_tokens or self._config.max_tokens_default,
                json_mode=request.json_mode,
                json_schema=request.json_schema,
                system_prompt=request.system_prompt or ACADEMIC_UKRAINIAN_SYSTEM,
            )
            messages = [{"role": "user", "content": request.prompt}]

            logger.info(
                "GenerateText: user=%s, session=%s, prompt_len=%d",
                user_id,
                request.session_id,
                len(request.prompt),
            )

            result = await self._provider.complete(messages, options)
            return GenerateTextResponse(
                text=result,
                model=self._provider.model,
            )
        finally:
            await self._rate_limiter.release(user_id)

    # ── GenerateTextStream (server-streaming) ────────────────────────

    async def GenerateTextStream(
        self, request: Any, context: grpc.ServicerContext
    ) -> AsyncIterator[Any]:
        from ai.proto.ai_pb2 import GenerateTextChunk

        self._require_enabled(context)
        user_id = self._get_user_id(context)
        if not await self._rate_limiter.acquire(user_id):
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "rate limit exceeded")
        try:
            options = CompletionOptions(
                temperature=request.temperature or self._config.temperature_default,
                max_tokens=request.max_tokens or self._config.max_tokens_default,
                json_mode=request.json_mode,
                json_schema=request.json_schema,
                system_prompt=request.system_prompt or ACADEMIC_UKRAINIAN_SYSTEM,
            )
            messages = [{"role": "user", "content": request.prompt}]

            logger.info(
                "GenerateTextStream: user=%s, session=%s, prompt_len=%d",
                user_id,
                request.session_id,
                len(request.prompt),
            )

            async for chunk in self._provider.stream(messages, options):
                if context.cancelled():
                    logger.info("GenerateTextStream: cancelled by client")
                    break
                yield GenerateTextChunk(
                    delta=chunk.delta,
                    done=chunk.done,
                    prompt_tokens=chunk.prompt_tokens,
                    completion_tokens=chunk.completion_tokens,
                )
        finally:
            await self._rate_limiter.release(user_id)

    # ── AnalyzeDocument (server-streaming) ───────────────────────────

    async def AnalyzeDocument(
        self, request: Any, context: grpc.ServicerContext
    ) -> AsyncIterator[Any]:
        from ai.proto.ai_pb2 import (
            AnalysisFinding,
            FindingCategory,
            FindingSeverity,
        )

        self._require_enabled(context)
        user_id = self._get_user_id(context)
        if not await self._rate_limiter.acquire(user_id):
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "rate limit exceeded")
        try:
            # Build sections summary for the prompt
            sections_summary = "\n".join(
                f"- {s.title} (id={s.id})" for s in request.sections
            ) if request.sections else "Немає інформації про секції"

            prompt = format_prompt(
                ANALYZE_DOCUMENT,
                topic=request.topic,
                report_type=request.report_type,
                sections_summary=sections_summary,
                content=request.content[:8000],  # Truncate for context window
            )

            options = CompletionOptions(
                temperature=0.3,
                max_tokens=4096,
                json_mode=True,
                system_prompt=ACADEMIC_UKRAINIAN_SYSTEM,
            )

            logger.info(
                "AnalyzeDocument: user=%s, doc=%s, content_len=%d, sections=%d",
                user_id,
                request.document_id,
                len(request.content),
                len(request.sections),
            )

            result = await self._provider.complete(
                [{"role": "user", "content": prompt}], options
            )

            # Parse the JSON response
            try:
                parsed = json.loads(result)
                findings_list = parsed.get("findings", [])
            except json.JSONDecodeError:
                logger.warning("Failed to parse analysis JSON, returning raw text")
                findings_list = [{
                    "section_id": "",
                    "anchor_text": "",
                    "severity": "info",
                    "category": "coherence",
                    "message": result[:500],
                }]

            severity_map = {
                "info": FindingSeverity.FINDING_SEVERITY_INFO,
                "warning": FindingSeverity.FINDING_SEVERITY_WARNING,
                "error": FindingSeverity.FINDING_SEVERITY_ERROR,
            }
            category_map = {
                "structure": FindingCategory.FINDING_CATEGORY_STRUCTURE,
                "topic_relevance": FindingCategory.FINDING_CATEGORY_TOPIC_RELEVANCE,
                "conclusions": FindingCategory.FINDING_CATEGORY_CONCLUSIONS,
                "coherence": FindingCategory.FINDING_CATEGORY_COHERENCE,
                "formatting": FindingCategory.FINDING_CATEGORY_FORMATTING,
            }

            for i, f in enumerate(findings_list):
                if context.cancelled():
                    break
                yield AnalysisFinding(
                    section_id=f.get("section_id", ""),
                    anchor_text=f.get("anchor_text", ""),
                    severity=severity_map.get(f.get("severity", ""), FindingSeverity.FINDING_SEVERITY_UNSPECIFIED),
                    category=category_map.get(f.get("category", ""), FindingCategory.FINDING_CATEGORY_UNSPECIFIED),
                    message=f.get("message", ""),
                    ordinal=i,
                )
        finally:
            await self._rate_limiter.release(user_id)

    # ── CorrectGrammar (server-streaming) ────────────────────────────

    async def CorrectGrammar(
        self, request: Any, context: grpc.ServicerContext
    ) -> AsyncIterator[Any]:
        from ai.proto.ai_pb2 import GrammarSuggestion, GrammarTier

        self._require_enabled(context)
        user_id = self._get_user_id(context)
        if not await self._rate_limiter.acquire(user_id):
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "rate limit exceeded")
        try:
            # Tier 1: LanguageTool
            if self._grammar_checker and request.language in ("uk", ""):
                matches = await self._grammar_checker.check(request.text)
                for m in matches:
                    if context.cancelled():
                        break
                    replacement = m.replacements[0] if m.replacements else ""
                    yield GrammarSuggestion(
                        offset=m.offset,
                        length=m.length,
                        original=request.text[m.offset : m.offset + m.length],
                        replacement=replacement,
                        message=m.message,
                        tier=GrammarTier.GRAMMAR_TIER_LANGUAGE_TOOL,
                        rule_id=m.rule_id,
                        context=[m.context],
                    )

            # Tier 2: LLM style check
            if request.include_style:
                prompt = format_prompt(GRAMMAR_CHECK, text=request.text)
                options = CompletionOptions(
                    temperature=0.3,
                    max_tokens=2048,
                    json_mode=True,
                    system_prompt=ACADEMIC_UKRAINIAN_SYSTEM,
                )

                logger.info("GrammarStyle: user=%s, text_len=%d", user_id, len(request.text))

                result = await self._provider.complete(
                    [{"role": "user", "content": prompt}], options
                )

                try:
                    parsed = json.loads(result)
                    for i, s in enumerate(parsed.get("suggestions", [])):
                        if context.cancelled():
                            break
                        original = s.get("original", "")
                        # Find offset in the text
                        offset = request.text.find(original)
                        yield GrammarSuggestion(
                            offset=offset if offset >= 0 else 0,
                            length=len(original),
                            original=original,
                            replacement=s.get("replacement", ""),
                            message=s.get("message", ""),
                            tier=GrammarTier.GRAMMAR_TIER_LLM_STYLE,
                            rule_id=s.get("rule_id", f"style_uk_{i}"),
                        )
                except json.JSONDecodeError:
                    logger.warning("Failed to parse grammar style JSON")
        finally:
            await self._rate_limiter.release(user_id)

    # ── FindSources (server-streaming) ───────────────────────────────

    async def FindSources(
        self, request: Any, context: grpc.ServicerContext
    ) -> AsyncIterator[Any]:
        from ai.proto.ai_pb2 import SourceSuggestion

        self._require_enabled(context)
        user_id = self._get_user_id(context)
        if not await self._rate_limiter.acquire(user_id):
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "rate limit exceeded")
        try:
            # Source suggestions
            prompt = format_prompt(
                SOURCE_SUGGESTIONS,
                topic=request.topic,
                section_text=request.section_text[:4000],
            )
            options = CompletionOptions(
                temperature=0.5,
                max_tokens=2048,
                json_mode=True,
                system_prompt=ACADEMIC_UKRAINIAN_SYSTEM,
            )

            logger.info("FindSources: user=%s, text_len=%d", user_id, len(request.section_text))

            result = await self._provider.complete(
                [{"role": "user", "content": prompt}], options
            )

            try:
                parsed = json.loads(result)
                yield SourceSuggestion(
                    search_queries=parsed.get("search_queries", []),
                    candidates=[
                        {
                            "csl_json": json.dumps(s, ensure_ascii=False),
                            "title": s.get("title", ""),
                            "authors": s.get("authors", ""),
                            "year": s.get("year", ""),
                            "url": "",
                        }
                        for s in parsed.get("candidate_sources", [])
                    ],
                    done=True,
                )
            except json.JSONDecodeError:
                yield SourceSuggestion(search_queries=[], done=True)

            # Citation consistency check
            for citation in request.citations:
                if context.cancelled():
                    break
                check_prompt = format_prompt(
                    CITATION_CHECK,
                    claim=citation.claim,
                    source_title=citation.source_title,
                    source_abstract=citation.source_abstract,
                )
                check_result = await self._provider.complete(
                    [{"role": "user", "content": check_prompt}],
                    CompletionOptions(temperature=0.2, max_tokens=512, json_mode=True),
                )
                try:
                    check_data = json.loads(check_result)
                    if not check_data.get("supported", True):
                        yield SourceSuggestion(
                            warnings=[{
                                "claim": citation.claim,
                                "source_title": citation.source_title,
                                "message": check_data.get("explanation", "Джерело не підтримує твердження"),
                            }],
                            done=False,
                        )
                except json.JSONDecodeError:
                    pass

            yield SourceSuggestion(done=True)
        finally:
            await self._rate_limiter.release(user_id)

    # ── ParseReference (unary) ───────────────────────────────────────

    async def ParseReference(self, request: Any, context: grpc.ServicerContext) -> Any:
        from ai.proto.ai_pb2 import ParseReferenceResponse

        self._require_enabled(context)
        user_id = self._get_user_id(context)
        if not await self._rate_limiter.acquire(user_id):
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "rate limit exceeded")
        try:
            prompt = format_prompt(FREEFORM_PARSE, raw_text=request.raw_text)
            options = CompletionOptions(
                temperature=0.2,
                max_tokens=1024,
                json_mode=True,
                system_prompt=ACADEMIC_UKRAINIAN_SYSTEM,
            )

            logger.info("ParseReference: user=%s, text_len=%d", user_id, len(request.raw_text))

            result = await self._provider.complete(
                [{"role": "user", "content": prompt}], options
            )

            try:
                parsed = json.loads(result)
                # Extract simple fields
                title = parsed.get("title", "")
                authors_list = parsed.get("author", [])
                authors = ", ".join(
                    f"{a.get('given', '')} {a.get('family', '')}".strip()
                    for a in authors_list
                ) if isinstance(authors_list, list) else str(authors_list)
                issued = parsed.get("issued", {})
                date_parts = issued.get("date-parts", [[]])
                year = str(date_parts[0][0]) if date_parts and date_parts[0] else ""

                return ParseReferenceResponse(
                    csl_json=json.dumps(parsed, ensure_ascii=False),
                    title=title,
                    authors=authors,
                    year=year,
                    confidence=True,
                )
            except json.JSONDecodeError:
                return ParseReferenceResponse(
                    csl_json="{}",
                    title="",
                    authors="",
                    year="",
                    confidence=False,
                )
        finally:
            await self._rate_limiter.release(user_id)

    # ── TransformSelection / ContinueWriting (server-streaming) ──────

    # Proto enum values for TransformKind; kept as a map so the wire enum and
    # the prompt catalogue stay in one place.
    _TRANSFORMS = {1: "rephrase", 2: "expand", 3: "condense", 4: "translate", 5: "academic"}

    async def TransformSelection(
        self, request: Any, context: grpc.ServicerContext
    ) -> AsyncIterator[Any]:
        """Rewrites a selection (FR-AI-06). Streams, so the editor can show the
        proposal forming and the user can cancel; nothing is ever applied to the
        document here — the client previews and applies."""
        from ai.proto.ai_pb2 import GenerateTextChunk

        self._require_enabled(context)
        user_id = self._get_user_id(context)

        text = request.text.strip()
        if not text:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "text must not be empty")

        kind = self._TRANSFORMS.get(request.transform)
        if kind is None:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "unknown transform")
        if kind == "translate":
            target = request.target_language or "en"
            instruction = TRANSLATE_INSTRUCTIONS.get(target)
            if instruction is None:
                context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"unsupported target language {target!r}")
        else:
            instruction = TRANSFORM_INSTRUCTIONS[kind]

        prompt = format_prompt(
            TRANSFORM_SELECTION,
            instruction=instruction,
            topic=request.topic,
            report_type=request.report_type,
            text=text,
        )

        if not await self._rate_limiter.acquire(user_id):
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "rate limit exceeded")
        try:
            # Expansion needs headroom; the rest should not run away from the
            # length of what the user selected.
            budget = len(text) * (4 if kind == "expand" else 2)
            options = CompletionOptions(
                temperature=0.4,
                max_tokens=min(max(budget, 256), self._config.max_tokens_default),
                system_prompt=ACADEMIC_UKRAINIAN_SYSTEM,
            )

            logger.info(
                "TransformSelection: user=%s, transform=%s, text_len=%d", user_id, kind, len(text)
            )

            async for chunk in self._provider.stream([{"role": "user", "content": prompt}], options):
                if context.cancelled():
                    logger.info("TransformSelection: cancelled by client")
                    break
                yield GenerateTextChunk(
                    delta=chunk.delta,
                    done=chunk.done,
                    prompt_tokens=chunk.prompt_tokens,
                    completion_tokens=chunk.completion_tokens,
                )
        finally:
            await self._rate_limiter.release(user_id)

    async def ContinueWriting(
        self, request: Any, context: grpc.ServicerContext
    ) -> AsyncIterator[Any]:
        """Continues from the cursor (FR-AI-06). Only the tail of the preceding
        text is sent: it is the part that governs the continuation, and it keeps
        the request inside the provider's context budget (FR-AI-02)."""
        from ai.proto.ai_pb2 import GenerateTextChunk

        self._require_enabled(context)
        user_id = self._get_user_id(context)

        preceding = request.preceding_text.strip()
        if not preceding:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "preceding_text must not be empty")

        prompt = format_prompt(
            CONTINUE_WRITING,
            topic=request.topic,
            report_type=request.report_type,
            section_title=request.section_title,
            preceding_text=preceding[-CONTINUATION_CONTEXT_CHARS:],
        )

        if not await self._rate_limiter.acquire(user_id):
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "rate limit exceeded")
        try:
            options = CompletionOptions(
                temperature=0.6,
                max_tokens=request.max_tokens or DEFAULT_CONTINUATION_TOKENS,
                system_prompt=ACADEMIC_UKRAINIAN_SYSTEM,
            )

            logger.info(
                "ContinueWriting: user=%s, context_len=%d", user_id, min(len(preceding), CONTINUATION_CONTEXT_CHARS)
            )

            async for chunk in self._provider.stream([{"role": "user", "content": prompt}], options):
                if context.cancelled():
                    logger.info("ContinueWriting: cancelled by client")
                    break
                yield GenerateTextChunk(
                    delta=chunk.delta,
                    done=chunk.done,
                    prompt_tokens=chunk.prompt_tokens,
                    completion_tokens=chunk.completion_tokens,
                )
        finally:
            await self._rate_limiter.release(user_id)

    # ── GetAIStatus (unary) ──────────────────────────────────────────

    async def GetAIStatus(self, request: Any, context: grpc.ServicerContext) -> Any:
        """What the client needs to render the AI tab honestly: the kill
        switch, which provider is running and whether it is local (FR-AI-04
        decides whether a consent notice is shown), whether tier-1 grammar is
        reachable, and the limits it will be held to (FR-AI-05)."""
        from ai.proto.ai_pb2 import AIStatusResponse

        return AIStatusResponse(
            enabled=self._config.ai_enabled,
            provider=self._provider.name,
            model=self._provider.model,
            local_provider=self._provider.name in LOCAL_PROVIDERS,
            grammar_available=self._grammar_checker is not None,
            max_concurrent_per_user=self._config.max_concurrent_per_user,
            max_requests_per_minute=self._config.max_requests_per_minute,
        )

    # ── Helpers ──────────────────────────────────────────────────────

    def _require_enabled(self, context: grpc.ServicerContext) -> None:
        if not self._config.ai_enabled:
            context.abort(grpc.StatusCode.FAILED_PRECONDITION, "AI features are disabled")

    @staticmethod
    def _get_user_id(context: grpc.ServicerContext) -> str:
        """The caller's id, used as the rate-limit key (FR-AI-05).

        `x-user-id` is the cross-service metadata contract (FR-ARC-15) — it is
        what the gateway injects after verifying the access token. `user-id` is
        accepted too, for direct calls that predate the contract.
        """
        metadata = dict(context.invocation_metadata())
        user_id = metadata.get("x-user-id") or metadata.get("user-id") or ""
        if not user_id:
            context.abort(grpc.StatusCode.UNAUTHENTICATED, "missing x-user-id")
        return user_id
