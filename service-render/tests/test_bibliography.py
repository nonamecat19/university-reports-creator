"""ДСТУ 8302:2015 formatting fixtures (FR-BIB-09).

One golden string per source type from FR-BIB-01, plus the numbering rules of
FR-BIB-06. These are the fixtures NFR-20 lists second in coverage priority;
they pin the Ukrainian punctuation conventions («та ін.», «С. », «Режим
доступу») so a formatter change can't silently alter every reference list.
"""

import json

from render.bibliography import format_entry, render_entries


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


class TestFormatEntry:
    def test_book_with_place_and_publisher(self):
        assert format_entry(
            csl(**{"publisher-place": "Київ", "publisher": "Наукова думка", "page": "320"})
        ) == "Іваненко, І.І. Основи програмування Київ : Наукова думка, 2019. 320 с."

    def test_journal_article_uses_pages_prefix(self):
        entry = format_entry(
            csl(type="article-journal", title="Аналіз алгоритмів", **{"container-title": "Вісник НТУУ", "page": "15-24"})
        )
        assert "// Вісник НТУУ." in entry
        assert entry.endswith("С. 15-24.")

    def test_conference_paper_uses_journal_shape(self):
        entry = format_entry(csl(type="paper-conference", **{"container-title": "Матеріали конференції"}))
        assert "// Матеріали конференції." in entry

    def test_thesis(self):
        entry = format_entry(
            csl(type="thesis", title="Моделювання систем", **{"publisher-place": "Львів", "page": "210"})
        )
        assert ": Львів," in entry
        assert entry.endswith("210 с.")

    def test_standard_has_no_author_lead(self):
        entry = format_entry(
            {"id": "s2", "type": "standard", "title": "ДСТУ 3008:2015 Звіти у сфері науки і техніки",
             "issued": {"date-parts": [[2015]]}}
        )
        assert entry.startswith("ДСТУ 3008:2015")
        assert "Введ. 2015." in entry

    def test_webpage_has_access_mode_and_date(self):
        entry = format_entry(
            csl(type="webpage", title="Про університет", URL="https://example.org",
                accessed={"date-parts": [[2026, 3, 14]]})
        )
        assert "Режим доступу: https://example.org" in entry
        assert "(дата звернення: 2026-3-14)" in entry

    def test_software_marked_as_electronic_resource(self):
        entry = format_entry(csl(type="software", title="Аналізатор", URL="https://git.example/app"))
        assert "[Електронний ресурс]." in entry
        assert "Режим доступу: https://git.example/app" in entry

    def test_four_or_more_authors_collapse_to_ta_in(self):
        authors = [{"family": f"Автор{i}", "given": "І."} for i in range(4)]
        assert format_entry(csl(author=authors)).startswith("Автор0, І. та ін.")

    def test_three_authors_are_all_listed(self):
        authors = [{"family": f"Автор{i}", "given": "І."} for i in range(3)]
        entry = format_entry(csl(author=authors))
        assert "Автор2" in entry
        assert "та ін." not in entry

    def test_missing_author_omits_lead(self):
        assert format_entry(csl(author=[])).startswith("Основи програмування")


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

    def test_invalid_json_is_skipped_not_fatal(self):
        entries = render_entries(["{oops", json.dumps(csl())], "by_order")
        assert len(entries) == 1
        assert entries[0]["number"] == 1
