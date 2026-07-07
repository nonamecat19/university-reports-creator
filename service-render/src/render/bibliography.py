"""ДСТУ 8302:2015-style bibliography formatting (FR-BIB-08..11).

This is a pragmatic per-type formatter, not a full CSL 1.0 engine — the spec's
own note is that no high-quality public ДСТУ 8302:2015 CSL style exists and
building+fixture-testing one (`styles/dstu-8302-2015.csl` + citeproc) is a
dedicated workstream (06-bibliography.md FR-BIB-09). This covers the common
source types with the Ukrainian punctuation conventions («та ін.», «С. »,
«Режим доступу») so bibliography rendering is usable end to end now; swapping
in a real citeproc engine later doesn't change the RenderService contract.
"""

from __future__ import annotations

import json
from typing import Any


def _authors_str(csl: dict) -> str:
    authors = csl.get("author") or []
    names = []
    for a in authors:
        family = a.get("family", "").strip()
        given = a.get("given", "").strip()
        initials = "".join(f"{p[0]}." for p in given.split() if p) if given else ""
        if family:
            names.append(f"{family}, {initials}" if initials else family)
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) <= 3:
        return ", ".join(names)
    return f"{names[0]} та ін."


def _year(csl: dict) -> str:
    issued = csl.get("issued") or {}
    parts = issued.get("date-parts") or [[]]
    if parts and parts[0]:
        return str(parts[0][0])
    return ""


def format_entry(csl: dict) -> str:
    """Formats one CSL-JSON source into a ДСТУ 8302:2015-ish reference string."""
    kind = csl.get("type", "book")
    title = csl.get("title", "").strip()
    authors = _authors_str(csl)
    year = _year(csl)
    publisher = csl.get("publisher", "").strip()
    place = csl.get("publisher-place", "").strip()
    pages = csl.get("page", "").strip()
    container = csl.get("container-title", "").strip()
    url = csl.get("URL", "").strip()
    accessed = (csl.get("accessed") or {}).get("date-parts", [[]])
    accessed_str = "-".join(str(p) for p in accessed[0]) if accessed and accessed[0] else ""

    lead = f"{authors} " if authors else ""

    if kind in ("webpage", "post-weblog"):
        parts = [f"{lead}{title}."]
        if url:
            parts.append(f"Режим доступу: {url}")
            if accessed_str:
                parts.append(f"(дата звернення: {accessed_str})")
        return " ".join(parts)

    if kind in ("article-journal", "article-magazine", "paper-conference"):
        parts = [f"{lead}{title}"]
        if container:
            parts.append(f"// {container}.")
        if year:
            parts.append(f"{year}.")
        if pages:
            parts.append(f"С. {pages}.")
        return " ".join(parts)

    if kind == "thesis":
        parts = [f"{lead}{title}"]
        if place:
            parts.append(f": {place},")
        if year:
            parts.append(f"{year}.")
        if pages:
            parts.append(f"{pages} с.")
        return " ".join(parts)

    if kind in ("standard", "legislation", "regulation"):
        parts = [title]
        if year:
            parts.append(f"— Введ. {year}.")
        return " ".join(p for p in parts if p)

    if kind in ("software", "dataset"):
        parts = [f"{lead}{title}", "[Електронний ресурс]."]
        if url:
            parts.append(f"Режим доступу: {url}")
        return " ".join(parts)

    # Default: book / book chapter / other.
    parts = [f"{lead}{title}"]
    if place or publisher:
        loc = f"{place} : {publisher}" if place and publisher else place or publisher
        parts.append(f"{loc},")
    if year:
        parts.append(f"{year}.")
    if pages:
        parts.append(f"{pages} с.")
    return " ".join(p for p in parts if p)


def render_entries(sources_csl_json: list[str], numbering_mode: str) -> list[dict[str, Any]]:
    """Returns [{number, source_id, formatted}], numbered per FR-BIB-06.

    `by_order` keeps the given order (citation-occurrence order is resolved
    by the caller before this point); `alphabetical` sorts Ukrainian/Cyrillic
    sources first, then Latin, both alphabetically per ДСТУ practice.
    """
    parsed = []
    for raw in sources_csl_json:
        try:
            csl = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        parsed.append(csl)

    if numbering_mode == "alphabetical":
        def sort_key(csl: dict) -> tuple[int, str]:
            formatted = format_entry(csl)
            is_latin = bool(formatted) and formatted[0].isascii()
            return (1 if is_latin else 0, formatted)

        parsed.sort(key=sort_key)

    return [
        {"number": i + 1, "source_id": csl.get("id", ""), "formatted": format_entry(csl)}
        for i, csl in enumerate(parsed)
    ]
