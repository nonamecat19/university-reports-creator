# 06 — Sources & Bibliography

## Purpose

A per-document source manager with autofill, CSL-based rendering with **ДСТУ 8302:2015** as the primary style, in-text citation nodes that stay synchronized with the auto-generated, auto-numbered reference list.

## Functional requirements

### Source manager

- **FR-BIB-01** Each document has a source library (right-panel tab + dedicated dialog). Source types: book, book chapter, journal article, conference paper, thesis/dissertation, standard (ДСТУ/ISO), law/regulation, webpage, software/dataset, other.
- **FR-BIB-02** Source data model is **CSL-JSON** (the citeproc input format) stored per source in SurrealDB, plus app-level fields: id, document_id, added_at, access_date, language (uk/en/other — affects ДСТУ rendering), raw_input (what the user pasted), fill_status (manual/auto/needs_review). CSL-JSON keeps the model style-agnostic.
- **FR-BIB-03** Manual entry form per type with uk-labeled fields (authors with «Прізвище, І. Б.» assist, title, city, publisher, year, pages, volume/issue, DOI, URL, access date). Required-field validation per type per ДСТУ 8302:2015.
- **FR-BIB-04** **Autofill** — user pastes an identifier or URL; the system resolves metadata:
  - DOI → Crossref REST API (`api.crossref.org/works/{doi}` returns CSL-JSON directly);
  - ISBN → OpenLibrary API;
  - URL → fetch page, extract citation metadata (Highwire/`citation_*` meta tags, OpenGraph, JSON-LD), fallback title+site+access date;
  - freeform pasted reference string → AI-assisted parse into CSL-JSON via service-ai ([08-ai.md](08-ai.md) FR-AI-13), fill_status `needs_review`.
  Resolution runs in service-render (single Python home for citeproc + resolvers); results always land in the form for user confirmation, never saved blind.

### Citations in text

- **FR-BIB-05** Inline **citation node** in the editor (`[N]` / `[N, с. 45]`): inserted via slash-menu or Ctrl+Shift+C with a source picker (search + "add new"). Node stores source id + optional locator (pages); the rendered number is computed, never stored.
- **FR-BIB-06** Numbering modes (per-document setting):
  - `by_order` (default): sources numbered by first citation occurrence;
  - `alphabetical`: list sorted per ДСТУ practice (Ukrainian/cyrillic sources first alphabetically, then latin), numbers assigned from the sorted list.
  All `[N]` renderings and the list re-number live on any change (insert/delete/move of citations, add/remove of sources).
- **FR-BIB-07** Uncited sources: included in the list only if flagged "include uncited" (off by default); orphaned citations (source deleted) are flagged in-editor and block export until resolved.

### Rendering (CSL engine)

- **FR-BIB-08** Reference list rendering via a citeproc engine in service-render (`citeproc-py` or `citeproc-rs` bindings). The style is a **CSL file**; adding APA/IEEE/Harvard later = dropping in a style file, zero code.
- **FR-BIB-09** **ДСТУ 8302:2015 CSL style**: no high-quality public CSL exists, so the project maintains its own `styles/dstu-8302-2015.csl` covering all FR-BIB-01 types, uk localization (Ukrainian punctuation/term conventions: «та ін.», «№ », «С. », «Режим доступу/URL», access date format). This style file is a deliverable with its own fixture test suite (input CSL-JSON → expected formatted string per type).
- **FR-BIB-10** The formatted list is rendered in three places from one engine: editor preview (right panel / dedicated section), docx export at the `{{bibliography}}` marker (as styled paragraphs, one per entry, numbered per FR-BIB-06), and PDF (inherited from docx).
- **FR-BIB-11** Style switching: per-document setting `citation_style` (MVP ships `dstu-8302-2015`; architecture accepts any CSL). Switching re-renders list and in-text formats.

## UX notes

- Source panel shows fill_status badges; `needs_review` sources are visually flagged until opened+confirmed.
- Citation node hover shows the full formatted reference as a tooltip.
- "Insert citation" flow optimized for speed: type-to-search over title/author, Enter inserts.

## Acceptance criteria

- Paste a DOI → confirmed autofilled article source → cite it twice → list shows one entry, both citations render the same `[N]`.
- Delete a cited source → in-editor orphan flags appear; export is blocked with a pointing message.
- Switching numbering mode re-numbers text and list consistently.
- ДСТУ style fixtures pass for every source type (golden strings reviewed against the standard).
- Exported docx contains the reference list at the `{{bibliography}}` marker using template paragraph styling.

## Open questions

- Import from BibTeX / Zotero RIS (P-later; CSL-JSON model makes it cheap).
- Per-citation suppress-number or multi-source citations `[3–5]` — MVP renders ranges automatically for adjacent multi-citations; authoring UI for grouped citations deferred.
