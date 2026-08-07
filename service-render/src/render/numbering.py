"""Document numbering (FR-EDT-07/08, FR-EXP-02): the same counter rules as
the client's `features/documents/editor/numbering.ts`, ported here so export
produces exactly what the editor showed — one spec, two implementations,
per FR-EXP-02.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

# ДСТУ 3008:2015 appendix lettering — Ukrainian alphabet excluding
# Ґ, Є, З, І, Ї, Й, О, Ч, Ь. Must match numbering.ts APPENDIX_LETTERS exactly.
APPENDIX_LETTERS = [
    "А", "Б", "В", "Г", "Д", "Е", "Ж", "И", "К", "Л", "М", "Н", "П", "Р", "С", "Т",
    "У", "Ф", "Х", "Ц", "Ш", "Щ", "Ю", "Я",
]

SectionKind = Literal["chapter", "appendix"]


# What a numbered block *is*, so a cross-reference can pick its wording
# («рис. 2.1» vs «табл. 2.1») without the reference node storing it.
NumberedKind = Literal["heading", "figure", "table", "formula"]


@dataclass
class NumberingInput:
    id: str
    kind: SectionKind
    order: int
    content: dict[str, Any] | None


@dataclass
class NumberingResult:
    section_labels: dict[str, str]
    block_numbers: dict[str, str]
    section_kinds: dict[str, SectionKind]
    block_kinds: dict[str, NumberedKind]


def _appendix_label(index: int) -> str:
    if index < len(APPENDIX_LETTERS):
        return APPENDIX_LETTERS[index]
    return f"Дод.{index + 1}"


def _walk(node: dict[str, Any], fn) -> None:
    fn(node)
    for child in node.get("content") or []:
        _walk(child, fn)


def compute_numbering(sections: list[NumberingInput]) -> NumberingResult:
    section_labels: dict[str, str] = {}
    block_numbers: dict[str, str] = {}
    section_kinds: dict[str, SectionKind] = {}
    block_kinds: dict[str, NumberedKind] = {}

    def record(block_id: str, number: str, kind: NumberedKind) -> None:
        block_numbers[block_id] = number
        block_kinds[block_id] = kind

    chapter_index = 0
    appendix_index = 0

    for section in sorted(sections, key=lambda s: s.order):
        if section.kind == "appendix":
            label = _appendix_label(appendix_index)
            appendix_index += 1
        else:
            chapter_index += 1
            label = str(chapter_index)
        section_labels[section.id] = label
        section_kinds[section.id] = section.kind

        if not section.content:
            continue

        heading_counters = [0, 0, 0]  # levels 2, 3, 4
        figure_counter = 0
        table_counter = 0
        formula_counter = 0

        def visit(node: dict[str, Any]) -> None:
            nonlocal figure_counter, table_counter, formula_counter
            block_id = (node.get("attrs") or {}).get("blockId")
            if not block_id:
                return

            node_type = node.get("type")
            if node_type == "heading":
                level = int((node.get("attrs") or {}).get("level", 1))
                if level < 2 or level > 4:
                    return
                idx = level - 2
                heading_counters[idx] += 1
                for j in range(idx + 1, len(heading_counters)):
                    heading_counters[j] = 0
                record(block_id, ".".join([label, *[str(c) for c in heading_counters[: idx + 1]]]), "heading")
                return

            if node_type == "image":
                figure_counter += 1
                record(block_id, f"{label}.{figure_counter}", "figure")
                return

            if node_type == "table":
                table_counter += 1
                record(block_id, f"{label}.{table_counter}", "table")
                return

            if node_type == "formulaBlock":
                formula_counter += 1
                record(block_id, f"{label}.{formula_counter}", "formula")

        _walk(section.content, visit)

    return NumberingResult(
        section_labels=section_labels,
        block_numbers=block_numbers,
        section_kinds=section_kinds,
        block_kinds=block_kinds,
    )


def figure_caption(number: str, caption: str) -> str:
    return f"Рисунок {number} — {caption}" if caption else f"Рисунок {number}"


def table_caption(number: str, caption: str) -> str:
    return f"Таблиця {number} — {caption}" if caption else f"Таблиця {number}"


def table_continuation_caption(number: str) -> str:
    """Heading above a table that continues on a following page (FR-TBL-09)."""
    return f"Продовження таблиці {number}"


def formula_number(number: str) -> str:
    """Formula numbers are bare parenthesised counters, right-aligned on the
    formula's line (ДСТУ 3008:2015)."""
    return f"({number})"


def section_label(kind: SectionKind, label: str) -> str:
    return f"Додаток {label}" if kind == "appendix" else f"Розділ {label}"


# In-text cross-reference wording (FR-EDT-04/07). Short forms, per Ukrainian
# academic practice: a caption reads «Рисунок 2.1 — …», a reference to it reads
# «рис. 2.1». Must match numbering.ts `referenceText` exactly.
_REFERENCE_PREFIX: dict[str, str] = {
    "heading": "розд. ",
    "figure": "рис. ",
    "table": "табл. ",
}

# Shown when the referenced block was deleted; export validation blocks on it,
# so it should never reach a finished document.
UNRESOLVED_REFERENCE = "[?]"


def reference_labels(result: NumberingResult) -> dict[str, str]:
    """targetId → rendered label, for every block and section a cross-reference
    can point at. Mirrors `referenceLabels()` in the client's numbering.ts."""
    labels: dict[str, str] = {}

    for block_id, number in result.block_numbers.items():
        kind = result.block_kinds.get(block_id)
        if kind == "formula":
            labels[block_id] = f"({number})"
        elif kind in _REFERENCE_PREFIX:
            labels[block_id] = f"{_REFERENCE_PREFIX[kind]}{number}"

    for section_id, label in result.section_labels.items():
        kind = result.section_kinds.get(section_id, "chapter")
        labels[section_id] = f"додаток {label}" if kind == "appendix" else f"розділ {label}"

    return labels
