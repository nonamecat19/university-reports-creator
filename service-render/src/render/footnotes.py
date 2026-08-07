"""Native Word footnotes for the docx export (FR-EDT-04).

The editor stores a footnote as an inline node carrying its text; the exported
file must carry a real `w:footnote`, not a superscript digit and a paragraph at
the bottom of the section. Only a real footnote gets renumbered by Word when
pagination changes, stays attached to its reference when text is edited, and
survives a round-trip through Word — which is the whole point of exporting to
docx rather than to PDF.

python-docx has no footnote API, so the part is written here the same way
`revisions.CommentsBuilder` writes the comments part: build the XML, then relate
it to the document part.
"""

from __future__ import annotations

from typing import Any

from docx.oxml import OxmlElement
from docx.oxml.ns import nsmap, qn
from docx.text.paragraph import Paragraph

FOOTNOTES_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"
)
FOOTNOTES_RELTYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes"
)

# Word expects these two special notes before any content note: the horizontal
# rule drawn above the footnote area, and its continued-on-next-page variant.
# A footnotes part without them opens, but Word repairs it on save.
SEPARATOR_ID = -1
CONTINUATION_SEPARATOR_ID = 0

# Content notes start after the two separators. Word renumbers the *displayed*
# numbers itself; these ids only tie a reference to its note.
FIRST_FOOTNOTE_ID = 1

_FOOTNOTES_XML_TEMPLATE = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<w:footnotes xmlns:w="{w}"></w:footnotes>'
).format(w=nsmap["w"])

# Style ids Word's own footnote machinery uses. Templates built from a Word
# footnote carry them; ones that never had a footnote do not, and Word falls
# back to Normal — legible either way, so a missing style is not an error.
REFERENCE_STYLE = "FootnoteReference"
TEXT_STYLE = "FootnoteText"


def _separator(footnote_id: int, kind: str) -> Any:
    footnote = OxmlElement("w:footnote")
    footnote.set(qn("w:type"), kind)
    footnote.set(qn("w:id"), str(footnote_id))

    para = OxmlElement("w:p")
    run = OxmlElement("w:r")
    run.append(OxmlElement(f"w:{kind}"))
    para.append(run)
    footnote.append(para)
    return footnote


def _superscript_run_properties() -> Any:
    """The reference mark is superscript by style, with a direct `vertAlign`
    as the fallback for templates that lack the style."""
    rpr = OxmlElement("w:rPr")
    style = OxmlElement("w:rStyle")
    style.set(qn("w:val"), REFERENCE_STYLE)
    rpr.append(style)
    vert_align = OxmlElement("w:vertAlign")
    vert_align.set(qn("w:val"), "superscript")
    rpr.append(vert_align)
    return rpr


class FootnotesBuilder:
    """Collects footnotes as they are emitted and, on `attach`, writes the part.

    Like the comments builder, it writes nothing when the document has no
    footnotes: an empty footnotes part is legal but makes Word offer an empty
    footnote area.
    """

    def __init__(self) -> None:
        self._notes: list[tuple[int, str]] = []
        self._next_id = FIRST_FOOTNOTE_ID

    def __len__(self) -> int:
        return len(self._notes)

    def add(self, paragraph: Paragraph, text: str) -> int:
        """Appends a reference mark to the paragraph and records the note."""
        footnote_id = self._next_id
        self._next_id += 1
        self._notes.append((footnote_id, text))

        run = OxmlElement("w:r")
        run.append(_superscript_run_properties())
        reference = OxmlElement("w:footnoteReference")
        reference.set(qn("w:id"), str(footnote_id))
        run.append(reference)
        paragraph._p.append(run)
        return footnote_id

    def attach(self, document: Any) -> None:
        if not self._notes:
            return

        from docx.opc.packuri import PackURI
        from docx.opc.part import Part
        from lxml import etree

        root = etree.fromstring(_FOOTNOTES_XML_TEMPLATE.encode("utf-8"))
        root.append(_separator(SEPARATOR_ID, "separator"))
        root.append(_separator(CONTINUATION_SEPARATOR_ID, "continuationSeparator"))

        for footnote_id, text in self._notes:
            footnote = OxmlElement("w:footnote")
            footnote.set(qn("w:id"), str(footnote_id))

            para = OxmlElement("w:p")
            ppr = OxmlElement("w:pPr")
            style = OxmlElement("w:pStyle")
            style.set(qn("w:val"), TEXT_STYLE)
            ppr.append(style)
            para.append(ppr)

            # The note's own reference mark, which Word replaces with the
            # rendered number.
            mark_run = OxmlElement("w:r")
            mark_run.append(_superscript_run_properties())
            mark_run.append(OxmlElement("w:footnoteRef"))
            para.append(mark_run)

            body = OxmlElement("w:r")
            node = OxmlElement("w:t")
            # A leading space separates the mark from the text and must not be
            # collapsed away.
            node.text = f" {text}"
            node.set(qn("xml:space"), "preserve")
            body.append(node)
            para.append(body)

            footnote.append(para)
            root.append(footnote)

        xml = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)

        # A template that already contains footnotes brings its own part. Two
        # footnotes relationships would leave Word with conflicting parts, so
        # the template's is dropped first — parts are serialized by walking the
        # relationship graph, and an unreferenced part is simply not written.
        for rel_id in _footnotes_rel_ids(document):
            document.part.drop_rel(rel_id)

        package = document.part.package
        part = Part(PackURI("/word/footnotes.xml"), FOOTNOTES_CONTENT_TYPE, xml, package)
        document.part.relate_to(part, FOOTNOTES_RELTYPE)


def _footnotes_rel_ids(document: Any) -> list[str]:
    return [
        rel_id
        for rel_id, rel in document.part.rels.items()
        if rel.reltype == FOOTNOTES_RELTYPE and not rel.is_external
    ]
