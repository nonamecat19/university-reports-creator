"""Resolver tests (FR-BIB-04). No network: classification and the HTML
metadata extractor are the parts that actually carry logic; the HTTP calls
themselves are thin."""

from render.resolvers import _MetaExtractor, _split_name, _year_from, classify


class TestClassify:
    def test_bare_doi(self):
        assert classify("10.1000/xyz123") == ("doi", "10.1000/xyz123")

    def test_doi_inside_url_prefers_doi(self):
        # A doi.org link resolves better through Crossref than through a
        # page scrape, so DOI detection wins over URL detection.
        assert classify("https://doi.org/10.1145/3178876.3186150") == (
            "doi",
            "10.1145/3178876.3186150",
        )

    def test_trailing_punctuation_stripped(self):
        assert classify("див. 10.1000/xyz123.") == ("doi", "10.1000/xyz123")

    def test_plain_url(self):
        assert classify("https://example.org/article") == ("url", "https://example.org/article")

    def test_isbn13_with_dashes(self):
        assert classify("ISBN 978-966-01-0123-4") == ("isbn", "9789660101234")

    def test_isbn10_with_x_checkdigit(self):
        assert classify("0-306-40615-X") == ("isbn", "030640615X")

    def test_freeform_reference_string(self):
        kind, value = classify("Шевченко Т. Г. Кобзар. Київ : Дніпро, 1980. 250 с.")
        assert kind == "freeform"
        assert value.startswith("Шевченко")

    def test_empty(self):
        assert classify("   ") == ("freeform", "")


class TestSplitName:
    def test_csl_ordered_name(self):
        assert _split_name("Шевченко, Тарас") == {"family": "Шевченко", "given": "Тарас"}

    def test_display_ordered_name(self):
        assert _split_name("Тарас Шевченко") == {"family": "Шевченко", "given": "Тарас"}

    def test_single_token_becomes_literal(self):
        # Never guess: an organisation name must not be split into given/family.
        assert _split_name("ДСТУ") == {"literal": "ДСТУ"}


class TestYearFrom:
    def test_extracts_from_iso_date(self):
        assert _year_from("2019-03-14T10:00:00Z") == 2019

    def test_extracts_from_prose(self):
        assert _year_from("Published March 2021") == 2021

    def test_none_when_absent(self):
        assert _year_from("no date here") is None


class TestMetaExtractor:
    def test_highwire_tags(self):
        meta = _MetaExtractor()
        meta.feed(
            """
            <html><head>
            <title>Fallback title</title>
            <meta name="citation_title" content="Аналіз даних">
            <meta name="citation_author" content="Іваненко, Іван">
            <meta name="citation_author" content="Петренко, Петро">
            <meta name="citation_publication_date" content="2020/05/01">
            </head><body></body></html>
            """
        )
        assert meta.first("citation_title") == "Аналіз даних"
        assert meta.all_of("citation_author") == ["Іваненко, Іван", "Петренко, Петро"]
        assert meta.title == "Fallback title"

    def test_open_graph_and_title_fallback(self):
        meta = _MetaExtractor()
        meta.feed('<html><head><title>Page</title><meta property="og:site_name" content="Site"></head></html>')
        assert meta.first("citation_title", "og:title", "dc.title") == ""
        assert meta.first("og:site_name") == "Site"
        assert meta.title == "Page"

    def test_json_ld(self):
        meta = _MetaExtractor()
        meta.feed(
            """
            <html><head><script type="application/ld+json">
            {"@type": "Article", "headline": "Заголовок", "datePublished": "2022-01-02",
             "author": [{"name": "Іваненко Іван"}]}
            </script></head></html>
            """
        )
        assert meta.first("dc.title") == "Заголовок"
        assert meta.first("dc.date") == "2022-01-02"
        assert meta.all_of("dc.creator") == ["Іваненко Іван"]

    def test_malformed_json_ld_is_ignored(self):
        meta = _MetaExtractor()
        meta.feed('<html><head><script type="application/ld+json">{ not json </script></head></html>')
        assert meta.first("dc.title") == ""
