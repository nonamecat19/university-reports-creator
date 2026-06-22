# 05 — Tables

## Purpose

Tables are a first-class user requirement: resizable columns in the editor and correct behavior in the exported docx — widths preserved, clean page-break continuation with repeated headers and the ДСТУ "continuation" caption convention.

## Functional requirements

### Editor

- **FR-TBL-01** Table editing via the TipTap table extension family: insert with size picker, add/remove rows/columns, merge/split cells, header-row toggle, cell alignment (horizontal + vertical), delete table.
- **FR-TBL-02** **Column resize**: drag handles between columns (TipTap `columnResizing`). Widths stored per column as **percentages of table width** in the node attrs; table width itself is 100% of the text column by default with an optional narrower percentage. Percentages are the persistence format — they translate deterministically to docx twips against the template's page setup (page width − margins).
- **FR-TBL-03** Minimum column width enforced (equivalent of ~10 mm) so a drag cannot produce unusable columns; resizing a column redistributes the delta to its right neighbor (Word-like behavior).
- **FR-TBL-04** Each table has a caption node bound above it: `Таблиця <chapter>.<index> — <caption text>` with auto-numbering per FR-EDT-07 and cross-reference support.
- **FR-TBL-05** Cell content: paragraphs, simple lists, inline marks, citations. No nested tables, no images in cells (validation prevents insertion). Keeps the docx mapping and page-breaking tractable.
- **FR-TBL-06** Header rows: one or more leading rows can be marked as header; header rows render visually distinct in the editor and drive `tblHeader` on export.

### docx export mapping (service-render)

- **FR-TBL-07** Table maps to OOXML:
  - `w:tblGrid` with `w:gridCol` widths in twips computed from stored percentages × available text width from the template's `w:sectPr` (page width − left/right margins);
  - `w:tblW` set to the corresponding `dxa` value (fixed layout, `w:tblLayout w:type="fixed"`), so Word does not auto-refit columns;
  - table style: template's default table style if defined, else explicit single ½pt borders per ДСТУ practice.
- **FR-TBL-08** **Page-break continuation**:
  - header rows emit `w:trPr/w:tblHeader` so Word repeats them automatically on every page the table spans;
  - all rows emit `w:trPr/w:cantSplit` so a row never breaks mid-row across pages (rows taller than a page are the one exception — Word overrides; a lint warning flags such rows pre-export);
  - the caption paragraph is bound to the table with `keepNext` so a caption never dangles at a page bottom.
- **FR-TBL-09** **"Продовження таблиці" convention** (ДСТУ 3008:2015): when a table continues on a following page, Ukrainian convention shows «Продовження таблиці N» above the continuation. Native Word has no such field, so this is implemented at export as a configurable strategy (template/export setting):
  - `repeat_header` (default): rely on `tblHeader` repeated rows only — always correct, standard-compliant in most departments;
  - `continuation_caption`: service-render performs a pagination pass (LibreOffice render to compute page breaks), splits the table at computed break points into separate tables, and inserts «Продовження таблиці N» paragraphs between them. Marked **best-effort**: any subsequent edit in Word can shift breaks; the export UI states this.
- **FR-TBL-10** Merged cells map to `gridSpan` (horizontal) and `vMerge` (vertical); the editor's merge model is restricted to rectangular merges so mapping is always valid.

### Validation

- **FR-TBL-11** Pre-export lint for tables: row taller than one page (estimate), table wider than text column (impossible by construction but validated), header marked but empty, > 20 columns (warning: unreadable at A4).

## Acceptance criteria

- Resize columns in editor → export → open in Word and LibreOffice: column proportions match the editor within rounding tolerance; layout is fixed (typing does not reflow column widths).
- A 3-page table exports with header rows repeated on pages 2–3; no row is split across pages.
- With `continuation_caption` strategy, «Продовження таблиці N» appears above each continuation in the exported file as rendered by LibreOffice.
- Merged-cell tables round-trip into valid OOXML (file opens with no repair prompt in Word).

## Open questions

- Landscape-orientation tables (own docx section with rotated page) — deferred, requires section-break handling in export; note as P-later.
