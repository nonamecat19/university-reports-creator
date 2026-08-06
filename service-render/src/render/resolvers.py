"""Source metadata resolvers (FR-BIB-04).

A pasted identifier is turned into draft CSL-JSON that the user confirms in
the entry form — results are never saved blind. Three resolvers:

  * DOI  → Crossref content negotiation, which returns CSL-JSON directly;
  * ISBN → OpenLibrary `api/books` (mapped into CSL-JSON here);
  * URL  → the page's own citation metadata (Highwire `citation_*` meta tags,
           JSON-LD, OpenGraph), falling back to title + site + access date.

Freeform reference strings are NOT handled here: they go to service-ai's
ParseReference (FR-AI-13), which the client calls directly through the
gateway — service-document may only call service-render (FR-ARC-07).
"""

from __future__ import annotations

import json
import re
from datetime import date
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse

import httpx

CROSSREF_URL = "https://api.crossref.org/works/{doi}/transform/application/vnd.citationstyles.csl+json"
OPENLIBRARY_URL = "https://openlibrary.org/api/books"

DOI_RE = re.compile(r"\b(10\.\d{4,9}/[-._;()/:a-zA-Z0-9]+)\b")
ISBN_RE = re.compile(r"\b(?:ISBN[:\s]*)?((?:97[89][-\s]?)?(?:\d[-\s]?){9}[\dXx])\b")
URL_RE = re.compile(r"https?://\S+")


class ResolveResult:
    __slots__ = ("csl", "resolver", "fill_status", "warning")

    def __init__(
        self,
        csl: dict[str, Any] | None,
        resolver: str,
        fill_status: str = "auto",
        warning: str = "",
    ) -> None:
        self.csl = csl
        self.resolver = resolver
        self.fill_status = fill_status
        self.warning = warning


def classify(raw: str) -> tuple[str, str]:
    """Returns (kind, normalized value): doi | isbn | url | freeform."""
    text = raw.strip()
    if not text:
        return "freeform", ""

    # A URL that embeds a DOI (doi.org/10.x, publisher landing pages) is still
    # best resolved through Crossref, so DOI detection runs first.
    doi = DOI_RE.search(text)
    if doi:
        return "doi", doi.group(1).rstrip(".,;)")

    url = URL_RE.search(text)
    if url:
        return "url", url.group(0).rstrip(".,;)")

    isbn = ISBN_RE.search(text)
    if isbn:
        digits = re.sub(r"[-\s]", "", isbn.group(1))
        if len(digits) in (10, 13):
            return "isbn", digits

    return "freeform", text


def resolve(raw: str, timeout_seconds: float = 10.0) -> ResolveResult:
    kind, value = classify(raw)
    if kind == "freeform":
        return ResolveResult(
            None,
            "none",
            "needs_review",
            "Не розпізнано DOI/ISBN/URL — скористайтесь розбором довільного посилання (AI) або заповніть форму вручну",
        )

    try:
        with httpx.Client(timeout=timeout_seconds, follow_redirects=True) as client:
            if kind == "doi":
                return _resolve_doi(client, value)
            if kind == "isbn":
                return _resolve_isbn(client, value)
            return _resolve_url(client, value)
    except httpx.HTTPError as exc:
        return ResolveResult(None, kind, "needs_review", f"Джерело недоступне: {exc}")


def _resolve_doi(client: httpx.Client, doi: str) -> ResolveResult:
    resp = client.get(CROSSREF_URL.format(doi=doi), headers={"Accept": "application/vnd.citationstyles.csl+json"})
    if resp.status_code == 404:
        return ResolveResult(None, "doi", "needs_review", f"DOI {doi} не знайдено у Crossref")
    resp.raise_for_status()
    csl = resp.json()
    csl.setdefault("id", doi)
    csl.setdefault("DOI", doi)
    return ResolveResult(csl, "doi")


def _resolve_isbn(client: httpx.Client, isbn: str) -> ResolveResult:
    resp = client.get(
        OPENLIBRARY_URL,
        params={"bibkeys": f"ISBN:{isbn}", "format": "json", "jscmd": "data"},
    )
    resp.raise_for_status()
    payload = resp.json() or {}
    book = payload.get(f"ISBN:{isbn}")
    if not book:
        return ResolveResult(None, "isbn", "needs_review", f"ISBN {isbn} не знайдено в OpenLibrary")

    csl: dict[str, Any] = {
        "id": isbn,
        "type": "book",
        "title": book.get("title", ""),
        "ISBN": isbn,
    }
    authors = [a.get("name", "") for a in book.get("authors", []) if a.get("name")]
    if authors:
        csl["author"] = [_split_name(name) for name in authors]
    publishers = [p.get("name", "") for p in book.get("publishers", []) if p.get("name")]
    if publishers:
        csl["publisher"] = publishers[0]
    places = [p.get("name", "") for p in book.get("publish_places", []) if p.get("name")]
    if places:
        csl["publisher-place"] = places[0]
    year = _year_from(book.get("publish_date", ""))
    if year:
        csl["issued"] = {"date-parts": [[year]]}
    if book.get("number_of_pages"):
        csl["number-of-pages"] = str(book["number_of_pages"])
    return ResolveResult(csl, "isbn")


def _resolve_url(client: httpx.Client, url: str) -> ResolveResult:
    resp = client.get(url, headers={"User-Agent": "university-reports-creator/1.0"})
    resp.raise_for_status()
    meta = _MetaExtractor()
    meta.feed(resp.text)

    today = date.today()
    csl: dict[str, Any] = {
        "id": url,
        "type": "webpage",
        "URL": url,
        "accessed": {"date-parts": [[today.year, today.month, today.day]]},
    }

    title = meta.first("citation_title", "og:title", "dc.title") or meta.title
    if title:
        csl["title"] = title.strip()

    site = meta.first("og:site_name", "citation_journal_title", "application-name")
    csl["container-title"] = (site or urlparse(url).netloc).strip()

    authors = meta.all_of("citation_author", "author", "dc.creator")
    if authors:
        csl["author"] = [_split_name(a) for a in authors]

    year = _year_from(meta.first("citation_publication_date", "article:published_time", "dc.date") or "")
    if year:
        csl["issued"] = {"date-parts": [[year]]}

    doi = meta.first("citation_doi", "dc.identifier")
    if doi and DOI_RE.search(doi):
        csl["DOI"] = DOI_RE.search(doi).group(1)
        csl["type"] = "article-journal"

    # A page that carries real Highwire/JSON-LD citation metadata is
    # trustworthy enough to land as `auto`; a bare title+site scrape is not.
    trusted = bool(meta.first("citation_title", "citation_author", "citation_doi"))
    if not csl.get("title"):
        return ResolveResult(csl, "url", "needs_review", "Сторінка не містить назви — заповніть вручну")
    return ResolveResult(csl, "url", "auto" if trusted else "needs_review")


def _split_name(name: str) -> dict[str, str]:
    """Splits a display name into CSL family/given parts.

    Handles both "Прізвище, Ім'я" (already CSL-ordered) and "Ім'я Прізвище";
    single-token names become a literal so nothing is silently dropped.
    """
    name = name.strip()
    if "," in name:
        family, _, given = name.partition(",")
        return {"family": family.strip(), "given": given.strip()}
    parts = name.split()
    if len(parts) == 1:
        return {"literal": name}
    return {"family": parts[-1], "given": " ".join(parts[:-1])}


def _year_from(value: str) -> int | None:
    match = re.search(r"(1[5-9]\d{2}|2\d{3})", value or "")
    return int(match.group(1)) if match else None


class _MetaExtractor(HTMLParser):
    """Collects <meta> name/property values, <title>, and JSON-LD blobs.

    stdlib-only on purpose: the pages we scrape are arbitrary and often
    malformed, and HTMLParser degrades gracefully where a strict XML parser
    would raise. Nothing here evaluates page script.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, list[str]] = {}
        self.title = ""
        self._in_title = False
        self._in_ldjson = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {k.lower(): (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (values.get("name") or values.get("property") or "").lower()
            content = values.get("content", "")
            if key and content:
                self.meta.setdefault(key, []).append(content)
        elif tag == "script" and values.get("type", "").lower() == "application/ld+json":
            self._in_ldjson = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "script":
            self._in_ldjson = False

    def handle_data(self, data: str) -> None:
        if self._in_title and not self.title:
            self.title = data.strip()
        elif self._in_ldjson:
            self._absorb_ldjson(data)

    def _absorb_ldjson(self, data: str) -> None:
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            return
        for node in payload if isinstance(payload, list) else [payload]:
            if not isinstance(node, dict):
                continue
            if node.get("headline") or node.get("name"):
                self.meta.setdefault("dc.title", []).append(str(node.get("headline") or node.get("name")))
            if node.get("datePublished"):
                self.meta.setdefault("dc.date", []).append(str(node["datePublished"]))
            author = node.get("author")
            names = author if isinstance(author, list) else [author]
            for a in names:
                if isinstance(a, dict) and a.get("name"):
                    self.meta.setdefault("dc.creator", []).append(str(a["name"]))
                elif isinstance(a, str):
                    self.meta.setdefault("dc.creator", []).append(a)

    def first(self, *keys: str) -> str:
        for key in keys:
            values = self.meta.get(key.lower())
            if values:
                return values[0]
        return ""

    def all_of(self, *keys: str) -> list[str]:
        for key in keys:
            values = self.meta.get(key.lower())
            if values:
                return values
        return []
