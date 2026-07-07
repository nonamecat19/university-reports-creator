"""Export translator (FR-EXP-01..03): merges document content into the
original template docx. Deterministic — same input bytes in, same output
bytes out (export determinism is an acceptance criterion, FR-EXP export
suite).
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any

import docx
from docx.oxml.ns import qn
from docx.shared import Emu
from docx.table import Table
from docx.text.paragraph import Paragraph

from . import numbering as num
from .bibliography import render_entries
from .docx_xml import (
    insert_toc_field,
    mark_header_row,
    new_paragraph_after,
    relocate_after,
    remove_paragraphs,
    set_cant_split,
    set_run_marks,
    set_update_fields_on_open,
)
from .placeholders import find_placeholders

PX_TO_EMU = 9525


@dataclass
class RenderSectionInput:
    id: str
    template_section_id: str
    title: str
    kind: str  # "chapter" | "appendix"
    order: int
    content: dict[str, Any] | None


def _substitute_scalar_fields(paragraph: Paragraph, values: dict[str, str]) -> None:
    runs = paragraph.runs
    if not runs:
        return
    full_text = "".join(r.text for r in runs)
    matches = find_placeholders(full_text)
    if not matches:
        return

    pieces: list[str] = []
    last_end = 0
    changed = False
    for match, placeholder in matches:
        if placeholder.kind != "field":
            continue
        value = values.get(placeholder.name or "", placeholder.default or "")
        pieces.append(full_text[last_end : match.start()])
        pieces.append(value)
        last_end = match.end()
        changed = True

    if not changed:
        return
    pieces.append(full_text[last_end:])
    runs[0].text = "".join(pieces)
    for r in runs[1:]:
        r.text = ""


def _find_marker(paragraphs: list[Paragraph], kind: str) -> Paragraph | None:
    for paragraph in paragraphs:
        for _match, placeholder in find_placeholders(paragraph.text):
            if placeholder.kind == kind:
                return paragraph
    return None


def _find_section_regions(paragraphs: list[Paragraph]) -> dict[str, tuple[int, int]]:
    """Returns {section_id: (start_index, end_index)} over the given
    paragraph list (indices inclusive of the marker paragraphs)."""
    regions: dict[str, tuple[int, int]] = {}
    open_id: str | None = None
    open_start = -1
    for i, paragraph in enumerate(paragraphs):
        for _match, placeholder in find_placeholders(paragraph.text):
            if placeholder.kind == "section_start":
                open_id = placeholder.name
                open_start = i
            elif placeholder.kind == "section_end" and open_id is not None:
                regions[open_id] = (open_start, i)
                open_id = None
    return regions


def _inline_text_runs(paragraph: Paragraph, inline_nodes: list[dict]) -> None:
    for node in inline_nodes or []:
        if node.get("type") != "text":
            continue
        run = paragraph.add_run(node.get("text", ""))
        set_run_marks(run, node.get("marks") or [])


def _translate_node(
    node: dict[str, Any],
    document: Any,
    images: dict[str, bytes],
    numbering_result: num.NumberingResult,
    anchor: Any,
) -> Any:
    node_type = node.get("type")
    block_id = (node.get("attrs") or {}).get("blockId")
    number = numbering_result.block_numbers.get(block_id or "")

    if node_type == "paragraph":
        para = new_paragraph_after(anchor, document)
        _inline_text_runs(para, node.get("content"))
        return para._p

    if node_type == "heading":
        level = int((node.get("attrs") or {}).get("level", 2))
        para = new_paragraph_after(anchor, document)
        try:
            para.style = document.styles[f"Heading {level}"]
        except KeyError:
            pass
        if number:
            para.add_run(f"{number} ").bold = True
        _inline_text_runs(para, node.get("content"))
        return para._p

    if node_type in ("bulletList", "orderedList"):
        style_name = "List Bullet" if node_type == "bulletList" else "List Number"
        current = anchor
        for item in node.get("content") or []:
            for child in item.get("content") or []:
                para = new_paragraph_after(current, document)
                try:
                    para.style = document.styles[style_name]
                except KeyError:
                    pass
                _inline_text_runs(para, child.get("content"))
                current = para._p
        return current

    if node_type == "table":
        rows = node.get("content") or []
        col_count = max((len(r.get("content") or []) for r in rows), default=1)
        row_count = max(len(rows), 1)

        # Caption goes ABOVE the table (FR-TBL-04), bound with keepNext so it
        # never dangles at a page bottom (FR-TBL-08).
        current = anchor
        if number:
            caption_para = new_paragraph_after(current, document)
            caption_para.add_run(num.table_caption(number, (node.get("attrs") or {}).get("caption", "")))
            caption_para.paragraph_format.keep_with_next = True
            current = caption_para._p

        table = document.add_table(rows=row_count, cols=col_count)
        relocate_after(table._tbl, current)

        header_row_count = 0
        for r_idx, row in enumerate(rows):
            cells = row.get("content") or []
            is_header_row = any(c.get("type") == "tableHeader" for c in cells)
            if is_header_row:
                header_row_count += 1
            for c_idx, cell in enumerate(cells):
                if c_idx >= col_count:
                    break
                docx_cell = table.cell(r_idx, c_idx)
                docx_cell.text = ""
                cell_para = docx_cell.paragraphs[0]
                for block in cell.get("content") or []:
                    if block.get("type") == "paragraph":
                        _inline_text_runs(cell_para, block.get("content"))

        for i in range(header_row_count):
            mark_header_row(table, i)
        set_cant_split(table)

        return table._tbl

    if node_type == "image":
        object_key = (node.get("attrs") or {}).get("objectKey")
        image_bytes = images.get(object_key) if object_key else None
        current = anchor
        if image_bytes:
            section = document.sections[0]
            text_width_emu = section.page_width - section.left_margin - section.right_margin
            natural_width_px = (node.get("attrs") or {}).get("naturalWidth")
            width = Emu(min(int(natural_width_px) * PX_TO_EMU, text_width_emu)) if natural_width_px else Emu(text_width_emu)
            picture = document.add_picture(io.BytesIO(image_bytes), width=width)
            image_paragraph = document.paragraphs[-1]
            relocate_after(image_paragraph._p, anchor)
            current = image_paragraph._p
        if number:
            caption_para = new_paragraph_after(current, document)
            caption_para.add_run(num.figure_caption(number, (node.get("attrs") or {}).get("caption", "")))
            current = caption_para._p
        return current

    if node_type == "codeBlock":
        para = new_paragraph_after(anchor, document)
        text = "".join(n.get("text", "") for n in node.get("content") or [] if n.get("type") == "text")
        run = para.add_run(text)
        run.font.name = "Courier New"
        return para._p

    if node_type == "horizontalRule":
        para = new_paragraph_after(anchor, document)
        run = para.add_run()
        run.add_break(7)  # WD_BREAK.PAGE
        return para._p

    return anchor


def _translate_section_content(
    content: dict[str, Any] | None,
    document: Any,
    images: dict[str, bytes],
    numbering_result: num.NumberingResult,
    anchor: Any,
) -> Any:
    if not content:
        return anchor
    current = anchor
    for node in content.get("content") or []:
        current = _translate_node(node, document, images, numbering_result, current)
    return current


def render_docx(
    template_docx: bytes,
    metadata: dict[str, str],
    sections: list[RenderSectionInput],
    sources_csl_json: list[str],
    images: dict[str, bytes],
    numbering_mode: str,
) -> tuple[bytes, list[dict]]:
    warnings: list[dict] = []
    document = docx.Document(io.BytesIO(template_docx))

    body_paragraphs = list(document.paragraphs)
    for paragraph in body_paragraphs:
        _substitute_scalar_fields(paragraph, metadata)
    for section in document.sections:
        for paragraph in list(section.header.paragraphs):
            _substitute_scalar_fields(paragraph, metadata)
        for paragraph in list(section.footer.paragraphs):
            _substitute_scalar_fields(paragraph, metadata)

    numbering_result = num.compute_numbering(
        [num.NumberingInput(id=s.id, kind=s.kind, order=s.order, content=s.content) for s in sections]
    )

    regions = _find_section_regions(body_paragraphs)
    by_template_id = {s.template_section_id: s for s in sections if s.template_section_id}
    extra_sections = sorted((s for s in sections if not s.template_section_id), key=lambda s: s.order)

    for region_id, (start_idx, end_idx) in regions.items():
        matching = by_template_id.get(region_id)
        region_paragraphs = body_paragraphs[start_idx : end_idx + 1]
        if matching is None:
            warnings.append(
                {"severity": "warning", "message": f"no document section for template region {region_id!r}; left as-is", "location": ""}
            )
            continue
        anchor = region_paragraphs[0]._p
        _translate_section_content(matching.content, document, images, numbering_result, anchor)
        remove_paragraphs(region_paragraphs)

    if extra_sections:
        tail_anchor = document.add_paragraph()._p
        for section in extra_sections:
            heading_para = new_paragraph_after(tail_anchor, document)
            try:
                heading_para.style = document.styles["Heading 1"]
            except KeyError:
                pass
            label = numbering_result.section_labels.get(section.id, "")
            heading_para.add_run(f"{num.section_label(section.kind, label)}. {section.title}").bold = True
            tail_anchor = heading_para._p
            tail_anchor = _translate_section_content(section.content, document, images, numbering_result, tail_anchor)

    bib_marker = _find_marker(list(document.paragraphs), "bibliography")
    if bib_marker is not None:
        entries = render_entries(sources_csl_json, numbering_mode)
        anchor = bib_marker._p
        for entry in entries:
            para = new_paragraph_after(anchor, document)
            para.add_run(f"{entry['number']}. {entry['formatted']}")
            anchor = para._p
        remove_paragraphs([bib_marker])

    toc_marker = _find_marker(list(document.paragraphs), "toc")
    if toc_marker is not None:
        for run in list(toc_marker.runs):
            run.text = ""
        insert_toc_field(toc_marker)

    set_update_fields_on_open(document)

    out = io.BytesIO()
    document.save(out)
    return out.getvalue(), warnings
