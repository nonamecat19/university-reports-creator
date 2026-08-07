"""ДСТУ 8302:2015 CSL fixtures (FR-BIB-09).

One golden string per source type from FR-BIB-01. These are the fixtures the
requirement calls for by name — the style file `styles/dstu-8302-2015.csl` is
a project deliverable, so its output is pinned here character for character
and a style edit that changes any reference has to be an explicit decision.

Also covers FR-BIB-06 numbering, which deliberately lives outside the CSL
engine, and FR-BIB-11 style selection.
"""

import json

import pytest

from render.bibliography import (
    DEFAULT_STYLE,
    UnknownStyleError,
    available_styles,
    format_entry,
    render_entries,
    style_path,
)


def csl(**overrides):
    base = {
        "id": "s1",
        "type": "book",
        "title": "Основи програмування",
        "author": [{"family": "Іваненко", "given": "Іван Іванович"}],
        "issued": {"date-parts": [[2019]]},
    }
    base.update(overrides)
    return base


class TestGoldenStrings:
    """Input CSL-JSON → expected formatted string, per FR-BIB-01 source type."""

    def test_book(self):
        assert format_entry(csl(**{
            "publisher-place": "Київ",
            "publisher": "Наукова думка",
            "number-of-pages": "320",
        })) == "Іваненко І. І. Основи програмування. Київ : Наукова думка, 2019. 320 с."

    def test_book_chapter(self):
        assert format_entry(csl(
            type="chapter",
            title="Розділ про алгоритми",
            **{
                "container-title": "Основи інформатики",
                "publisher-place": "Київ",
                "publisher": "Наука",
                "page": "15-40",
            },
        )) == "Іваненко І. І. Розділ про алгоритми. Основи інформатики. Київ : Наука, 2019. С. 15–40."

    def test_journal_article(self):
        assert format_entry(csl(
            type="article-journal",
            title="Аналіз алгоритмів",
            **{"container-title": "Вісник НТУУ", "issue": "4", "page": "15-24"},
        )) == "Іваненко І. І. Аналіз алгоритмів. Вісник НТУУ. 2019. № 4. С. 15–24."

    def test_conference_paper(self):
        assert format_entry(csl(
            type="paper-conference",
            title="Метод оптимізації",
            **{
                "container-title": "Матеріали конференції",
                "publisher-place": "Львів",
                "page": "12-15",
            },
        )) == "Іваненко І. І. Метод оптимізації. Матеріали конференції. Львів, 2019. С. 12–15."

    def test_thesis_keeps_the_genre_after_a_colon(self):
        assert format_entry(csl(
            type="thesis",
            title="Моделювання систем",
            genre="дис. ... канд. техн. наук",
            **{"publisher-place": "Львів", "number-of-pages": "210"},
        )) == "Іваненко І. І. Моделювання систем : дис. ... канд. техн. наук. Львів, 2019. 210 с."

    def test_standard_leads_with_its_designation_not_an_author(self):
        assert format_entry({
            "id": "s2",
            "type": "standard",
            "number": "ДСТУ 3008:2015",
            "title": "Звіти у сфері науки і техніки",
            "publisher-place": "Київ",
            "publisher": "УкрНДНЦ",
            "issued": {"date-parts": [[2015]]},
            "number-of-pages": "26",
        }) == "ДСТУ 3008:2015. Звіти у сфері науки і техніки. Київ : УкрНДНЦ, 2015. 26 с."

    def test_legislation(self):
        assert format_entry({
            "id": "s3",
            "type": "legislation",
            "title": "Про освіту",
            "genre": "Закон України",
            "number": "2145-VIII",
            "container-title": "Відомості Верховної Ради України",
            "issued": {"date-parts": [[2017]]},
            "issue": "38-39",
        }) == "Про освіту : Закон України № 2145-VIII. Відомості Верховної Ради України. 2017. № 38-39."

    def test_webpage_ends_with_url_and_access_date(self):
        assert format_entry(csl(
            type="webpage",
            title="Про університет",
            URL="https://example.org",
            accessed={"date-parts": [[2026, 3, 14]]},
            **{"container-title": "Освітній портал"},
        )) == (
            "Іваненко І. І. Про університет. Освітній портал. "
            "URL: https://example.org (дата звернення: 14.03.2026)."
        )

    def test_software_is_marked_as_an_electronic_resource(self):
        assert format_entry(csl(
            type="software",
            title="Аналізатор",
            URL="https://git.example/app",
            accessed={"date-parts": [[2026, 1, 2]]},
        )) == (
            "Іваненко І. І. Аналізатор [Електронний ресурс]. "
            "URL: https://git.example/app (дата звернення: 02.01.2026)."
        )

    def test_unknown_type_falls_back_to_the_book_shape(self):
        assert format_entry(csl(type="manuscript")).startswith("Іваненко І. І. Основи програмування.")


class TestAuthors:
    def test_initials_follow_the_family_name_without_a_comma(self):
        assert format_entry(csl()).startswith("Іваненко І. І.")

    def test_three_authors_are_all_listed_and_comma_separated(self):
        authors = [{"family": f"Автор{i}", "given": "Іван"} for i in range(3)]
        entry = format_entry(csl(author=authors))
        assert entry.startswith("Автор0 І., Автор1 І., Автор2 І.")
        assert "та ін." not in entry
        # ДСТУ never joins the last two authors with «і».
        assert " і " not in entry

    def test_four_or_more_authors_collapse_to_ta_in(self):
        authors = [{"family": f"Автор{i}", "given": "Іван"} for i in range(4)]
        assert format_entry(csl(author=authors)).startswith("Автор0 І. та ін.")

    def test_missing_author_starts_with_the_title(self):
        assert format_entry(csl(author=[])).startswith("Основи програмування")

    def test_editor_substitutes_for_a_missing_author(self):
        entry = format_entry(csl(author=[], editor=[{"family": "Редактор", "given": "Роман"}]))
        assert entry.startswith("Редактор Р.")


class TestMissingData:
    """A half-filled source still has to render — students save drafts."""

    def test_title_only(self):
        assert format_entry({"id": "x", "type": "book", "title": "Без даних"}) == "Без даних."

    def test_no_year_leaves_no_dangling_separator(self):
        entry = format_entry(csl(issued=None, **{"publisher-place": "Київ"}))
        assert ".." not in entry
        assert entry == "Іваненко І. І. Основи програмування. Київ."

    def test_no_publisher_keeps_the_year(self):
        assert format_entry(csl()) == "Іваненко І. І. Основи програмування. 2019."


class TestRenderEntries:
    def test_by_order_keeps_caller_order(self):
        sources = [json.dumps(csl(id="b", title="Друга")), json.dumps(csl(id="a", title="Перша"))]
        entries = render_entries(sources, "by_order")
        assert [e["source_id"] for e in entries] == ["b", "a"]
        assert [e["number"] for e in entries] == [1, 2]

    def test_alphabetical_puts_cyrillic_before_latin(self):
        sources = [
            json.dumps(csl(id="lat", title="Algorithms", author=[{"family": "Knuth", "given": "D."}])),
            json.dumps(csl(id="cyr", title="Алгоритми")),
        ]
        entries = render_entries(sources, "alphabetical")
        assert [e["source_id"] for e in entries] == ["cyr", "lat"]

    def test_numbers_are_assigned_after_sorting(self):
        sources = [
            json.dumps(csl(id="lat", title="Algorithms", author=[{"family": "Knuth", "given": "D."}])),
            json.dumps(csl(id="cyr", title="Алгоритми")),
        ]
        entries = render_entries(sources, "alphabetical")
        assert {e["source_id"]: e["number"] for e in entries} == {"cyr": 1, "lat": 2}

    def test_invalid_json_is_skipped_not_fatal(self):
        entries = render_entries(["{oops", json.dumps(csl())], "by_order")
        assert len(entries) == 1
        assert entries[0]["number"] == 1

    def test_source_without_an_id_still_renders(self):
        entries = render_entries([json.dumps({"type": "book", "title": "Анонім"})], "by_order")
        assert len(entries) == 1
        assert entries[0]["formatted"] == "Анонім."

    def test_empty_input(self):
        assert render_entries([], "by_order") == []


class TestStyleSelection:
    """FR-BIB-11: the style is a file, so switching styles is dropping one in."""

    def test_default_style_ships_with_the_service(self):
        assert DEFAULT_STYLE in available_styles()
        assert style_path(DEFAULT_STYLE).is_file()

    def test_unknown_style_is_rejected(self):
        with pytest.raises(UnknownStyleError):
            style_path("apa")

    @pytest.mark.parametrize("name", ["../../etc/passwd", "a/b", "style;rm"])
    def test_style_name_cannot_escape_the_styles_directory(self, name):
        with pytest.raises(UnknownStyleError):
            style_path(name)
