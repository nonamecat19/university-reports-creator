"""gRPC server for service-render (FR-API-11)."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import grpc

from .bibliography import render_entries
from .config import RenderConfig
from .docx_export import RenderComment, RenderSectionInput, render_docx
from .pdf_convert import PdfConversionError, convert_docx_to_pdf
from .resolvers import resolve as resolve_source
from .template_parser import TemplateParseError, parse_template

logger = logging.getLogger(__name__)

APPENDIX_KIND = 2


class RenderServicer:
    """Implements the RenderService gRPC interface. Stateless (FR-ARC-07):
    every RPC receives everything it needs in the request and returns bytes;
    no data is retained between calls."""

    def __init__(self, config: RenderConfig) -> None:
        self._config = config

    async def Ping(self, request: Any, context: grpc.aio.ServicerContext) -> Any:
        from render.proto import render_pb2

        return render_pb2.PingResponse(status="ok")

    async def ParseTemplate(self, request: Any, context: grpc.aio.ServicerContext) -> Any:
        from render.proto import render_pb2

        try:
            model, diagnostics = parse_template(
                bytes(request.docx_bytes), self._config.max_decompressed_bytes
            )
        except TemplateParseError as exc:
            logger.info("ParseTemplate rejected upload: %s", exc)
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
            return

        return render_pb2.ParseTemplateResponse(
            model_json=json.dumps(model, ensure_ascii=False),
            diagnostics=[
                render_pb2.Diagnostic(severity=d["severity"], message=d["message"], location=d.get("location", ""))
                for d in diagnostics
            ],
        )

    async def RenderDocx(self, request: Any, context: grpc.aio.ServicerContext) -> Any:
        from render.proto import render_pb2

        sections = [
            RenderSectionInput(
                id=s.id,
                template_section_id=s.template_section_id,
                title=s.title,
                kind="appendix" if s.kind == APPENDIX_KIND else "chapter",
                order=s.order,
                content=_parse_content_json(s.content_json),
            )
            for s in request.sections
        ]

        # Comments only reach the file when the caller asked for them
        # (FR-EXP-04 include_comments), even if it sent the list anyway.
        comments = (
            [
                RenderComment(
                    section_id=c.section_id,
                    block_id=c.block_id,
                    body=c.body,
                    author_id=c.author_id,
                    timestamp=c.timestamp,
                )
                for c in request.comments
            ]
            if request.options.include_comments
            else []
        )

        try:
            docx_bytes, warnings = render_docx(
                template_docx=bytes(request.template_docx),
                metadata=dict(request.metadata),
                sections=sections,
                sources_csl_json=list(request.sources_csl_json),
                images={k: bytes(v) for k, v in request.images.items()},
                numbering_mode=request.options.numbering_mode or "by_order",
                suggestions_strategy=request.options.suggestions_strategy or "clean",
                comments=comments,
                authors=dict(request.authors),
            )
        except Exception as exc:  # noqa: BLE001 - surfaced to the caller as INTERNAL
            logger.exception("RenderDocx failed")
            await context.abort(grpc.StatusCode.INTERNAL, f"render failed: {exc}")
            return

        return render_pb2.RenderDocxResponse(
            docx_bytes=docx_bytes,
            warnings=[
                render_pb2.Diagnostic(severity=w["severity"], message=w["message"], location=w.get("location", ""))
                for w in warnings
            ],
        )

    async def ConvertPdf(self, request: Any, context: grpc.aio.ServicerContext) -> Any:
        from render.proto import render_pb2

        try:
            pdf_bytes = convert_docx_to_pdf(
                bytes(request.docx_bytes), self._config.libreoffice_bin, self._config.libreoffice_timeout_seconds
            )
        except PdfConversionError as exc:
            logger.warning("ConvertPdf failed: %s", exc)
            await context.abort(grpc.StatusCode.UNAVAILABLE, str(exc))
            return

        return render_pb2.ConvertPdfResponse(pdf_bytes=pdf_bytes)

    async def RenderBibliography(self, request: Any, context: grpc.aio.ServicerContext) -> Any:
        from render.proto import render_pb2

        entries = render_entries(list(request.sources_csl_json), request.numbering_mode or "by_order")
        return render_pb2.RenderBibliographyResponse(
            entries=[
                render_pb2.BibliographyEntry(number=e["number"], source_id=e["source_id"], formatted=e["formatted"])
                for e in entries
            ]
        )

    async def ResolveSource(self, request: Any, context: grpc.aio.ServicerContext) -> Any:
        from render.proto import render_pb2

        # Network I/O is blocking (httpx sync client), so it runs off the
        # event loop — otherwise one slow publisher stalls every RPC the
        # server is serving.
        result = await asyncio.to_thread(resolve_source, request.input, self._config.resolver_timeout_seconds)
        return render_pb2.ResolveSourceResponse(
            csl_json=json.dumps(result.csl, ensure_ascii=False) if result.csl else "",
            resolver=result.resolver,
            fill_status=result.fill_status,
            warning=result.warning,
        )


def _parse_content_json(content_json: str) -> dict[str, Any] | None:
    if not content_json:
        return None
    try:
        parsed = json.loads(content_json)
    except json.JSONDecodeError:
        return None
    return parsed if parsed.get("type") == "doc" else None
