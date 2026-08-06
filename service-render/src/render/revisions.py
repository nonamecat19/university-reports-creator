"""Track changes and comments in the exported docx (FR-REV-13).

Pending suggestions carried as ProseMirror marks (`suggestionInsert` /
`suggestionDelete`) become native OOXML revisions — `w:ins` / `w:del` with
author and date — so a supervisor opening the file in Word sees real tracked
changes. Comments become a real `/word/comments.xml` part with
`w:commentRangeStart|End` + `w:commentReference` anchors.

Three export strategies (FR-EXP-04):

  * ``with_track_changes`` — insertions and deletions survive as revisions;
  * ``all_accepted``       — insertions stay as plain text, deletions vanish;
  * ``clean``              — insertions vanish, deletions stay as plain text
                             (i.e. pending suggestions rejected in the output).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from docx.oxml import OxmlElement
from docx.oxml.ns import nsmap, qn

SUGGESTION_INSERT = "suggestionInsert"
SUGGESTION_DELETE = "suggestionDelete"

STRATEGY_TRACK_CHANGES = "with_track_changes"
STRATEGY_ALL_ACCEPTED = "all_accepted"
STRATEGY_CLEAN = "clean"

# Word requires w:id to be unique per document across revisions and comments.
_UNKNOWN_AUTHOR = "Рецензент"


class RevisionIds:
    """Monotonic id source for w:ins/w:del/w:comment elements."""

    def __init__(self) -> None:
        self._next = 1

    def take(self) -> int:
        value = self._next
        self._next += 1
        return value


def suggestion_mark(marks: list[dict]) -> dict | None:
    """Returns the insertion/deletion mark on a text node, if any."""
    for mark in marks or []:
        if mark.get("type") in (SUGGESTION_INSERT, SUGGESTION_DELETE):
            return mark
    return None


def should_emit_text(mark: dict | None, strategy: str) -> bool:
    """Whether a text node carrying `mark` produces any output at all.

    Accepting drops deletions; rejecting (clean) drops insertions. With track
    changes everything is emitted and the revision markup carries the intent.
    """
    if mark is None:
        return True
    kind = mark.get("type")
    if strategy == STRATEGY_ALL_ACCEPTED:
        return kind != SUGGESTION_DELETE
    if strategy == STRATEGY_CLEAN:
        return kind != SUGGESTION_INSERT
    return True


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _mark_timestamp(mark: dict) -> str:
    raw = mark.get("attrs", {}).get("timestamp")
    if isinstance(raw, str) and raw:
        return raw
    return _iso_now()


def _mark_author(mark: dict, authors: dict[str, str]) -> str:
    author_id = mark.get("attrs", {}).get("authorId") or ""
    return authors.get(author_id) or author_id or _UNKNOWN_AUTHOR


def wrap_revision(run: Any, mark: dict, ids: RevisionIds, authors: dict[str, str]) -> None:
    """Wraps an already-added run in `w:ins` or `w:del` in place.

    For a deletion, `w:t` must additionally become `w:delText` — Word ignores
    a `w:t` inside `w:del` and the text silently disappears.
    """
    kind = mark.get("type")
    tag = "w:ins" if kind == SUGGESTION_INSERT else "w:del"

    r = run._r
    parent = r.getparent()
    index = list(parent).index(r)

    wrapper = OxmlElement(tag)
    wrapper.set(qn("w:id"), str(ids.take()))
    wrapper.set(qn("w:author"), _mark_author(mark, authors))
    wrapper.set(qn("w:date"), _mark_timestamp(mark))

    parent.remove(r)
    wrapper.append(r)
    parent.insert(index, wrapper)

    if kind == SUGGESTION_DELETE:
        for t in r.findall(qn("w:t")):
            del_text = OxmlElement("w:delText")
            del_text.text = t.text
            # Deleted text is routinely leading/trailing whitespace around an
            # edit; without xml:space Word collapses it and the reverted text
            # comes back malformed.
            del_text.set(qn("xml:space"), "preserve")
            r.replace(t, del_text)


# ── Comments part (FR-REV-13) ────────────────────────────────────────

COMMENTS_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"
)
COMMENTS_RELTYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
)

_COMMENTS_XML_TEMPLATE = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<w:comments xmlns:w="{w}"></w:comments>'
).format(w=nsmap["w"])


class CommentsBuilder:
    """Accumulates comments and, on `attach`, writes the comments part.

    Kept separate from the translator so a document with no comments produces
    no comments part at all — an empty part is legal but makes Word show an
    empty reviewing pane.
    """

    def __init__(self, ids: RevisionIds, authors: dict[str, str]) -> None:
        self._ids = ids
        self._authors = authors
        self._comments: list[tuple[int, str, str, str]] = []

    def add(self, paragraph: Any, body: str, author_id: str, timestamp: str = "") -> None:
        """Anchors a comment over an entire paragraph.

        Intra-paragraph ranges are not reconstructed: the exported anchor is
        the block, matching what the editor guarantees survives edits
        (FR-REV-05 anchors on block_id; offsets are an in-editor refinement).
        """
        comment_id = self._ids.take()
        author = self._authors.get(author_id) or author_id or _UNKNOWN_AUTHOR
        self._comments.append((comment_id, body, author, timestamp or _iso_now()))

        p = paragraph._p
        start = OxmlElement("w:commentRangeStart")
        start.set(qn("w:id"), str(comment_id))
        p.insert(0, start)

        end = OxmlElement("w:commentRangeEnd")
        end.set(qn("w:id"), str(comment_id))
        p.append(end)

        run = OxmlElement("w:r")
        reference = OxmlElement("w:commentReference")
        reference.set(qn("w:id"), str(comment_id))
        run.append(reference)
        p.append(run)

    def attach(self, document: Any) -> None:
        if not self._comments:
            return

        from docx.opc.packuri import PackURI
        from docx.opc.part import Part
        from lxml import etree

        root = etree.fromstring(_COMMENTS_XML_TEMPLATE.encode("utf-8"))
        for comment_id, body, author, timestamp in self._comments:
            comment = OxmlElement("w:comment")
            comment.set(qn("w:id"), str(comment_id))
            comment.set(qn("w:author"), author)
            comment.set(qn("w:date"), timestamp)
            # Word derives reviewer colours and the "AB" avatar from initials.
            comment.set(qn("w:initials"), "".join(part[0] for part in author.split()[:2]).upper())

            para = OxmlElement("w:p")
            run = OxmlElement("w:r")
            text = OxmlElement("w:t")
            text.text = body
            text.set(qn("xml:space"), "preserve")
            run.append(text)
            para.append(run)
            comment.append(para)
            root.append(comment)

        package = document.part.package
        part = Part(
            PackURI("/word/comments.xml"),
            COMMENTS_CONTENT_TYPE,
            etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True),
            package,
        )
        document.part.relate_to(part, COMMENTS_RELTYPE)
