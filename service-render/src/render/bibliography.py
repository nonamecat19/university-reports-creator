"""Reference-list rendering through a real CSL engine (FR-BIB-08..11).

The style is a **file**, not code: `styles/dstu-8302-2015.csl` ships with the
service and is the project's own ДСТУ 8302:2015 deliverable (FR-BIB-09).
Adding APA/IEEE/Harvard later is dropping another `.csl` next to it — hence
`STYLES_DIR` / `style_path()` rather than a hard-coded filename.

Numbering stays outside the engine on purpose. FR-BIB-06's `by_order` /
`alphabetical` modes are an application concern (they depend on where
citations occur in the document, which citeproc never sees), so the style's
bibliography layout emits no number and `render_entries` assigns them.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from citeproc import Citation, CitationItem, CitationStylesBibliography, CitationStylesStyle
from citeproc import formatter
from citeproc.source.json import CiteProcJSON

logger = logging.getLogger(__name__)

STYLES_DIR = Path(__file__).parent / "styles"
DEFAULT_STYLE = "dstu-8302-2015"


class UnknownStyleError(ValueError):
    """Raised for a `citation_style` with no CSL file (FR-BIB-11)."""


def style_path(style: str) -> Path:
    """Resolves a document's `citation_style` setting to its CSL file.

    The name is used as a filename, so it is validated rather than trusted —
    it arrives from a per-document setting.
    """
    name = (style or DEFAULT_STYLE).strip()
    if not name.replace("-", "").replace("_", "").replace(".", "").isalnum():
        raise UnknownStyleError(f"invalid citation style name {style!r}")
    path = STYLES_DIR / f"{name}.csl"
    if not path.is_file():
        raise UnknownStyleError(f"no CSL style file for {style!r}")
    return path


def available_styles() -> list[str]:
    return sorted(p.stem for p in STYLES_DIR.glob("*.csl"))


def _normalize(csl: dict[str, Any], index: int) -> dict[str, Any]:
    """Prepares one CSL-JSON item for the engine.

    citeproc-py keys its source by item id, so every item needs a unique,
    non-empty one — sources created before an id was assigned still have to
    render.
    """
    # A null variable is not the same as an absent one to citeproc-py — it
    # dereferences dates and name lists without checking — and autofill happily
    # produces `"issued": null` for a source with no date.
    item = {key: value for key, value in csl.items() if value is not None and value != []}
    item["id"] = str(item.get("id") or f"source-{index}")
    item.setdefault("type", "book")
    return item


def _render_all(items: list[dict[str, Any]], style: str) -> list[str]:
    """Formats every item, in the given order, as a plain-text reference."""
    if not items:
        return []

    bibliography_style = CitationStylesStyle(str(style_path(style)), validate=False)
    source = CiteProcJSON(items)
    bibliography = CitationStylesBibliography(bibliography_style, source, formatter.plain)

    for item in items:
        bibliography.register(Citation([CitationItem(item["id"])]))

    rendered = [str(entry) for entry in bibliography.bibliography()]
    return [_tidy(text) for text in rendered]


# An ellipsis is meaningful content («дис. ... канд. техн. наук»), so it is
# hidden from the cleanup below and restored afterwards.
_ELLIPSIS_GUARD = "\x00"
_REPEATED_PERIOD_RE = re.compile(r"\.{2,}")


def _tidy(text: str) -> str:
    """Collapses the doubled full stops CSL leaves behind.

    An element that already ends in «.» (initials, «с.», an abbreviated genre)
    meets the layout's own «. » delimiter or final «.», which is the one
    artefact the style itself cannot avoid without wrapping every element in a
    `choose`.
    """
    cleaned = " ".join(text.split()).replace("...", _ELLIPSIS_GUARD)
    cleaned = _REPEATED_PERIOD_RE.sub(".", cleaned)
    return cleaned.replace(_ELLIPSIS_GUARD, "...").strip()


def format_entry(csl: dict[str, Any], style: str = DEFAULT_STYLE) -> str:
    """Formats one CSL-JSON source. Convenience wrapper used by tests and by
    the citation tooltip path."""
    return _render_all([_normalize(csl, 0)], style)[0]


def render_entries(
    sources_csl_json: list[str],
    numbering_mode: str,
    style: str = DEFAULT_STYLE,
) -> list[dict[str, Any]]:
    """Returns [{number, source_id, formatted}], numbered per FR-BIB-06.

    `by_order` keeps the given order (citation-occurrence order is resolved by
    the caller before this point); `alphabetical` sorts Ukrainian/Cyrillic
    sources first, then Latin, both alphabetically per ДСТУ practice.
    """
    parsed: list[dict[str, Any]] = []
    for raw in sources_csl_json:
        try:
            csl = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(csl, dict):
            parsed.append(_normalize(csl, len(parsed)))

    if not parsed:
        return []

    try:
        formatted = _render_all(parsed, style)
    except UnknownStyleError:
        raise
    except Exception:  # noqa: BLE001 - a broken source must not fail the export
        logger.exception("CSL rendering failed; falling back to per-item rendering")
        formatted = [_render_one_safely(item, style) for item in parsed]

    pairs = list(zip(parsed, formatted, strict=True))
    if numbering_mode == "alphabetical":
        pairs.sort(key=lambda pair: (1 if pair[1][:1].isascii() else 0, pair[1]))

    return [
        {"number": i + 1, "source_id": item.get("id", ""), "formatted": text}
        for i, (item, text) in enumerate(pairs)
    ]


def _render_one_safely(item: dict[str, Any], style: str) -> str:
    """Last resort for a single unrenderable source: its title, so the entry is
    still identifiable in the list instead of vanishing."""
    try:
        return _render_all([item], style)[0]
    except Exception:  # noqa: BLE001
        logger.warning("source %s could not be rendered by the CSL engine", item.get("id"))
        return str(item.get("title") or item.get("id") or "")
