"""Placeholder syntax (FR-TPL-05): {{field}}, {{field|attr|attr=val}},
{{#section:id|attrs}} ... {{/section}}, {{bibliography}}, {{toc}}.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

PLACEHOLDER_RE = re.compile(r"\{\{(.*?)\}\}")

# FR-TPL-07: well-known field names map to typed fields; unknown names are
# plain text. Only "year" gets a non-text type in this MVP mapping.
WELL_KNOWN_FIELDS = (
    "student_name",
    "university",
    "faculty",
    "department",
    "group",
    "supervisor",
    "topic",
    "city",
    "year",
)
_WELL_KNOWN_TYPES = {"year": "number"}


@dataclass
class ParsedPlaceholder:
    kind: str  # "field" | "section_start" | "section_end" | "bibliography" | "toc"
    name: str | None = None
    label: str | None = None
    required: bool = False
    default: str | None = None
    section_kind: str | None = None  # "chapter" | "appendix"
    min_words: int | None = None


def field_type(name: str) -> str:
    return _WELL_KNOWN_TYPES.get(name, "text")


def field_label(name: str) -> str:
    """Auto-generated label from a field name (FR-TPL-05: "attribute-less
    placeholders get a label auto-generated from the name")."""
    return name.replace("_", " ").strip().capitalize()


def _parse_attrs(parts: list[str]) -> dict:
    attrs: dict = {"label": None, "required": False, "default": None, "kind": None, "min_words": None}
    for raw in parts:
        part = raw.strip()
        if not part:
            continue
        if part == "required":
            attrs["required"] = True
        elif "=" in part:
            key, value = part.split("=", 1)
            key = key.strip()
            value = value.strip()
            if key == "min_words":
                attrs["min_words"] = int(value) if value.isdigit() else None
            elif key in ("label", "default", "kind"):
                attrs[key] = value
    return attrs


def parse_placeholder(inner: str) -> ParsedPlaceholder:
    """Parses the content between `{{` and `}}` (exclusive)."""
    text = inner.strip()

    if text.startswith("#section:"):
        body = text[len("#section:") :]
        parts = body.split("|")
        section_id = parts[0].strip()
        attrs = _parse_attrs(parts[1:])
        return ParsedPlaceholder(
            kind="section_start",
            name=section_id,
            label=attrs["label"] or field_label(section_id),
            required=attrs["required"],
            section_kind=attrs["kind"] or "chapter",
            min_words=attrs["min_words"],
        )

    if text == "/section":
        return ParsedPlaceholder(kind="section_end")

    if text == "bibliography":
        return ParsedPlaceholder(kind="bibliography")

    if text == "toc":
        return ParsedPlaceholder(kind="toc")

    parts = text.split("|")
    name = parts[0].strip()
    attrs = _parse_attrs(parts[1:])
    return ParsedPlaceholder(
        kind="field",
        name=name,
        label=attrs["label"] or field_label(name),
        required=attrs["required"],
        default=attrs["default"],
    )


def find_placeholders(text: str) -> list[tuple[re.Match, ParsedPlaceholder]]:
    """Finds every `{{...}}` occurrence in already-concatenated paragraph text
    (FR-TPL-06: matching operates on concatenated text, not individual runs)."""
    return [(m, parse_placeholder(m.group(1))) for m in PLACEHOLDER_RE.finditer(text)]


def find_unclosed(text: str) -> bool:
    """Detects `{{` without a matching `}}` later in the string — a parse
    warning per FR-TPL-10."""
    depth = 0
    i = 0
    while i < len(text) - 1:
        if text[i : i + 2] == "{{":
            depth += 1
            i += 2
            continue
        if text[i : i + 2] == "}}":
            if depth > 0:
                depth -= 1
            i += 2
            continue
        i += 1
    return depth > 0
