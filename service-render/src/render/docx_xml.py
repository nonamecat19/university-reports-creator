"""Low-level OOXML insertion helpers. python-docx only appends at the end of
the document body; export needs to insert translated content at a specific
point (where a `{{#section}}` region or `{{bibliography}}`/`{{toc}}` marker
was) — these helpers move newly-created elements next to an anchor and return
the new anchor, so callers can chain insertions in order.
"""

from __future__ import annotations

from typing import Any

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph


def new_paragraph_after(anchor: Any, parent: Any) -> Paragraph:
    p = OxmlElement("w:p")
    anchor.addnext(p)
    return Paragraph(p, parent)


def relocate_after(element: Any, anchor: Any) -> Any:
    """Detaches `element` from wherever it currently is and reinserts it
    immediately after `anchor`. Returns `element` (the new anchor)."""
    element.getparent().remove(element)
    anchor.addnext(element)
    return element


def remove_paragraphs(paragraphs: list[Paragraph]) -> None:
    for p in paragraphs:
        el = p._p
        parent = el.getparent()
        if parent is not None:
            parent.remove(el)


def set_run_marks(run: Any, marks: list[dict]) -> None:
    for mark in marks:
        kind = mark.get("type")
        if kind == "bold":
            run.bold = True
        elif kind == "italic":
            run.italic = True
        elif kind == "underline":
            run.underline = True
        elif kind == "strike":
            run.font.strike = True
        elif kind == "subscript":
            run.font.subscript = True
        elif kind == "superscript":
            run.font.superscript = True


def set_update_fields_on_open(document: Any) -> None:
    """Sets `w:updateFields` in settings.xml so Word/LibreOffice refresh the
    TOC page numbers on open (FR-EXP-03)."""
    settings = document.settings.element
    existing = settings.find(qn("w:updateFields"))
    if existing is None:
        existing = OxmlElement("w:updateFields")
        settings.append(existing)
    existing.set(qn("w:val"), "true")


def insert_toc_field(paragraph: Paragraph) -> None:
    """Inserts a `TOC \\o "1-3" \\h \\z \\u` field into the given (already
    empty) paragraph (FR-EXP-03)."""
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = 'TOC \\o "1-3" \\h \\z \\u'
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    placeholder_run = OxmlElement("w:r")
    placeholder_text = OxmlElement("w:t")
    placeholder_text.text = "Right-click to update table of contents."
    placeholder_run.append(placeholder_text)
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")

    run._r.append(fld_begin)
    run._r.append(instr)
    paragraph._p.append(fld_sep)
    paragraph._p.append(placeholder_run)
    end_run = OxmlElement("w:r")
    end_run.append(fld_end)
    paragraph._p.append(end_run)


def mark_header_row(table: Table, row_index: int) -> None:
    """Sets `w:trPr/w:tblHeader` on a row so Word repeats it across pages
    (FR-TBL-08)."""
    row = table.rows[row_index]
    tr_pr = row._tr.get_or_add_trPr()
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "true")
    tr_pr.append(header)


def set_cant_split(table: Table) -> None:
    """Sets `w:cantSplit` on every row so a row never breaks mid-page
    (FR-TBL-08)."""
    for row in table.rows:
        tr_pr = row._tr.get_or_add_trPr()
        cant_split = OxmlElement("w:cantSplit")
        tr_pr.append(cant_split)
