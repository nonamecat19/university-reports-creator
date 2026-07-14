---
name: dstu-formatting
description: "Ukrainian academic document formatting rules per DSTU 3008:2015 (layout) and DSTU 8302:2015 (bibliography). Use when working on document templates, export logic, section numbering, figure/table captions, bibliography/citations, appendix lettering, or any formatting-related code. Covers the project's core value proposition — guaranteeing correct Ukrainian university report formatting."
---

# DSTU Formatting Rules

Expert reference for Ukrainian state standards governing academic document formatting. Use this when implementing or reviewing any code related to document structure, export, templates, or bibliography.

## DSTU 3008:2015 — Layout & Structure

### Section Numbering (FR-EDT-07)

Decimal hierarchical numbering: `2`, `2.1`, `2.1.3`. Automatically computed from document structure — never hand-typed by users. Numbering reflows live on reorder/insert/delete.

### Figure Numbering & Captions

Format: **`Рисунок <chapter>.<index> — <caption>`**
- Caption appears **below** the image
- Example: `Рисунок 2.1 — Архітектура системи`

### Table Numbering & Captions

Format: **`Таблиця <chapter>.<index> — <caption>`**
- Caption appears **above** the table
- Example: `Таблиця 3.2 — Порівняння алгоритмів`

### Table Continuation (FR-TBL-09)

When a table spans pages: **`Продовження таблиці N`** above the continued portion.
- `repeat_header` strategy: uses `tblHeader` repeated rows (default, standard-compliant)
- `continuation_caption` strategy: service-render pagination pass, splits table, inserts continuation paragraphs

### Formula Numbering

Format: **`(<chapter>.<index>)`** — right-aligned
- Example: `(2.1)`

### Appendix Lettering

Appendix headings use Ukrainian alphabet letters (subset — excludes Ґ, Є, З, І, Ї, Й, О, Ч, Ь):

**А, Б, В, Г, Д, Е, Ж, И, К, Л, М, Н, П, Р, С, Т, У, Ф, Х, Ц, Ш, Щ, Ю, Я**

Pattern: `Додаток А`, `Додаток Б`, etc.
Figures/tables/formulas inside appendix: `А.1`, `А.2` (letter replaces chapter number).

### Typography (FR-EDT-04)

Typography is **template-owned**, not editor-owned. The ProseMirror schema deliberately excludes font-family, font-size, and color marks. The editor approximates `Times New Roman 14pt / 1.5 line spacing` visually, but actual formatting comes from the department's docx template at export time.

### Locale Strings (FR-EDT-08, NFR-13)

Centralized Ukrainian strings, independent of UI language:
- `Рисунок` (Figure)
- `Таблиця` (Table)
- `Продовження таблиці` (Table continuation)
- `Додаток` (Appendix)

---

## DSTU 8302:2015 — Bibliography & Citations

### Custom CSL Style

The project maintains `styles/dstu-8302-2015.csl` — no quality public implementation exists. Ukrainian localization (uk) with specific conventions:
- `та ін.` (et al.)
- `№` (number sign)
- `С.` (page, Ukrainian)
- `Режим доступу/URL` (access mode/URL)

### Source Types (FR-BIB-01)

10 types: Book, Book chapter, Journal article, Conference paper, Thesis/dissertation, Standard (ДСТУ/ISO), Law/regulation, Webpage, Software/dataset, Other.

### Citation Numbering Modes (FR-BIB-06)

- **`by_order`** (default): numbered by first citation occurrence
- **`alphabetical`**: Ukrainian/Cyrillic sources first alphabetically, then Latin, numbered from sorted list

### In-Text Citations (FR-BIB-05)

Rendered as **`[N]`** or **`[N, с. 45]`** (with optional page locator). Numbers are **computed, never stored** — they update dynamically when sources are reordered.

### Reference List (FR-BIB-10)

Rendered via citeproc engine. Three targets from one engine: editor preview, docx export at `{{bibliography}}` marker, PDF (inherited from docx).

### Manual Entry Fields (FR-BIB-03)

Authors in Ukrainian format: `Прізвище, І. Б.`. Required fields per type per DSTU 8302:2015: title, city, publisher, year, pages, volume/issue, DOI, URL, access date.

### Autofill Sources (FR-BIB-04)

- DOI → Crossref REST API (returns CSL-JSON)
- ISBN → OpenLibrary API
- URL → page scraping (Highwire/citation_* meta tags, OpenGraph, JSON-LD)
- Freeform text → AI parsing into CSL-JSON with `fill_status: needs_review`

---

## Export Rules

### Filename Convention (FR-EXP-07)

Pattern: `{surname}_{report_type}_{topic-slug}_{yyyy-mm-dd}.docx|pdf` — transliterated, length-capped.

### Pre-Export Validation (FR-EXP-06)

Blocking: required metadata empty, required sections empty, orphaned citations, unreferenced figures/tables.
Warnings: table lint findings, word-count targets.

### Cross-References (FR-EDT-04)

Reference nodes resolve against same counters as live numbering. Rendered as literal text (`рис. 2.1`, `табл. 3.2`) — not Word REF fields in MVP.

### TOC (FR-EXP-03)

- Native TOC field in template: preserved
- `{{toc}}` marker: inserts `TOC \o "1-3" \h \z \u` field
- `w:updateFields` set so Word/LibreOffice refreshes on open

### Version Snapshots (FR-EDT-10)

Full snapshots (not diffs). Created: manually, before export, before bulk suggestion accept, at most once per hour of active editing.

---

## Document Types

All share the same system; differ only in template structure.

### Course Work (Курсова робота)
Title page → Task sheet → Abstract → TOC → Introduction → 2-4 chapters → Conclusions → References → Appendices

### Diploma Thesis (Дипломна робота)
Title page → Task assignment → Calendar plan → Abstract (UA + EN) → TOC → Introduction → 2-4 chapters → Conclusions → References → Appendices

### Practice Report (Звіт з практики)
Title page → Individual task → Diary/log tables → Content sections → Conclusions → References

---

## AI Academic Style Rules

When generating or correcting Ukrainian academic text:
1. Formal academic style — no first person singular (я, мене, мої)
2. Avoid канцеляризми (bureaucraticisms), tautologies, anglicisms
3. Follow DSTU 3008:2015 style
4. Respond in Ukrainian unless specified otherwise
5. Use impersonal constructions for scientific works
