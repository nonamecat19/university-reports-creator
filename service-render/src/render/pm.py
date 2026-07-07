"""Minimal python-docx paragraph → ProseMirror JSON conversion, used to build
a template section's example content (FR-TPL-08 `sections[].example content`).
Mirrors the client schema (FR-EDT-04) closely enough for prefill purposes —
it is not a general docx→ProseMirror importer (that's the P-later "docx draft
import" backlog item).
"""

from __future__ import annotations

import re
import uuid
from typing import Any

_HEADING_STYLE_RE = re.compile(r"heading\s*(\d+)", re.IGNORECASE)


def new_block_id() -> str:
    return str(uuid.uuid4())


def _runs_to_text_nodes(runs: Any) -> list[dict]:
    nodes: list[dict] = []
    for run in runs:
        if not run.text:
            continue
        marks = []
        if run.bold:
            marks.append({"type": "bold"})
        if run.italic:
            marks.append({"type": "italic"})
        if run.underline:
            marks.append({"type": "underline"})
        node: dict[str, Any] = {"type": "text", "text": run.text}
        if marks:
            node["marks"] = marks
        nodes.append(node)
    return nodes


def paragraph_to_pm_node(paragraph: Any) -> dict | None:
    """Converts a python-docx Paragraph to a paragraph or heading PM node.
    Returns None for empty paragraphs (dropped from example content)."""
    text = paragraph.text
    style_name = paragraph.style.name if paragraph.style else ""

    match = _HEADING_STYLE_RE.search(style_name or "")
    if match:
        level = min(max(int(match.group(1)), 2), 4)
        content = _runs_to_text_nodes(paragraph.runs) or [{"type": "text", "text": text or " "}]
        return {
            "type": "heading",
            "attrs": {"level": level, "blockId": new_block_id()},
            "content": content,
        }

    if not text.strip():
        return None

    return {
        "type": "paragraph",
        "attrs": {"blockId": new_block_id()},
        "content": _runs_to_text_nodes(paragraph.runs),
    }


def paragraphs_to_pm_doc(paragraphs: list[Any]) -> dict:
    """Builds a `{type: doc, content: [...]}` example-content document from a
    list of python-docx paragraphs, falling back to a single empty paragraph
    (TipTap needs at least one block to be clickable — see the client's
    document-content.util.ts EMPTY_DOC)."""
    nodes = [n for n in (paragraph_to_pm_node(p) for p in paragraphs) if n is not None]
    if not nodes:
        nodes = [{"type": "paragraph", "attrs": {"blockId": new_block_id()}, "content": []}]
    return {"type": "doc", "content": nodes}
