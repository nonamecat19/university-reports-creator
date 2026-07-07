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

        if not section.content:
            continue

        heading_counters = [0, 0, 0]  # levels 2, 3, 4
        figure_counter = 0
        table_counter = 0

        def visit(node: dict[str, Any]) -> None:
            nonlocal figure_counter, table_counter
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
                block_numbers[block_id] = ".".join([label, *[str(c) for c in heading_counters[: idx + 1]]])
                return

            if node_type == "image":
                figure_counter += 1
                block_numbers[block_id] = f"{label}.{figure_counter}"
                return

            if node_type == "table":
                table_counter += 1
                block_numbers[block_id] = f"{label}.{table_counter}"

        _walk(section.content, visit)

    return NumberingResult(section_labels=section_labels, block_numbers=block_numbers)


def figure_caption(number: str, caption: str) -> str:
    return f"Рисунок {number} — {caption}" if caption else f"Рисунок {number}"


def table_caption(number: str, caption: str) -> str:
    return f"Таблиця {number} — {caption}" if caption else f"Таблиця {number}"


def section_label(kind: SectionKind, label: str) -> str:
    return f"Додаток {label}" if kind == "appendix" else f"Розділ {label}"
