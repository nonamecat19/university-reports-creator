# 04 — Document Model & Editor

## Purpose

Define the hybrid document model (metadata form + rich-text sections) and the web editor the student writes in. The editor is the heart of the product; its content model must map cleanly onto docx at export.

## Document model

A **Document** is created from a template version and consists of:

- `metadata`: values for the template's scalar fields (`{{student_name}}` → "Іваненко І.І.").
- `sections[]`: one entry per template `{{#section}}` region — id, template section id, title, order, ProseMirror JSON content. Sections defined by the template cannot be deleted if `required`; students MAY add extra sections (appendices, additional chapters) where the template allows (template flag `allow_extra_sections`, default true).
- `sources[]`: bibliography entries ([06-bibliography.md](06-bibliography.md)).
- review data: comments, suggestions, shares ([07-review-mode.md](07-review-mode.md)).
- `versions[]`: snapshots (FR-EDT-10).

## Functional requirements

### Editor shell

- **FR-EDT-01** Document page layout: left sidebar — section outline (navigable, drag-reorder for non-fixed sections); main pane — metadata form (collapsible) above the section editors; right sidebar — contextual panel (comments / AI / sources, tabbed).
- **FR-EDT-02** Metadata form is generated from the template's `fields[]` (labels, types, required). Required-but-empty fields are flagged inline and at export time (export shows a blocking checklist).
- **FR-EDT-03** Rich-text sections use **TipTap (ProseMirror)** in the Angular client. One editor instance per section (keeps documents scalable and maps 1:1 to template regions).

### Content schema (ProseMirror node types)

- **FR-EDT-04** Allowed nodes/marks, chosen strictly for representability in docx. **Every block node carries a stable `block_id` UUID attr**, assigned on insert, preserved across edits/moves, regenerated for copy-paste duplicates — comment anchors (FR-REV-05), cross-references, and the suggestion registry all target block IDs, never positions alone:
  - blocks: paragraph, heading (levels 2–4; level 1 is the section title itself), bullet/ordered list, table ([05-tables.md](05-tables.md)), image (with caption), formula block, code block, page-break hint;
  - inline: text with bold/italic/underline/strikethrough/sub/superscript, inline formula, **citation node** (references a source id, renders as `[N]` — [06-bibliography.md](06-bibliography.md)), **cross-reference node** (references a figure/table/section by its `block_id`, renders as "рис. 2.1", "табл. 3.2"), footnote (deferred if costly);
  - no font-family/size/color marks — typography comes from the template's styles at export. This is a deliberate constraint: the editor edits structure and content, the template owns appearance.
- **FR-EDT-05** Images: pasted/uploaded images go to MinIO (`images/` bucket) via service-files; the node stores the object key + natural size + caption + label number. Accepted: png/jpeg/svg (svg rasterized at export), max 10 MB.
- **FR-EDT-06** Formulas: LaTeX source stored in the node, rendered client-side with KaTeX; exported to docx as OMML (LaTeX→OMML conversion in service-render) with image fallback for unsupported constructs.

### Numbering & captions (ДСТУ 3008:2015)

- **FR-EDT-07** Automatic numbering computed from document structure, not hand-typed:
  - sections/headings: `2`, `2.1`, `2.1.3`;
  - figures: `Рисунок <chapter>.<index> — <caption>` below the image;
  - tables: `Таблиця <chapter>.<index> — <caption>` above the table;
  - formulas: `(<chapter>.<index>)` right-aligned;
  - **appendices**: sections have `kind: chapter | appendix`. Appendix headings letter per ДСТУ 3008:2015 — «Додаток А», «Додаток Б», … using the Ukrainian alphabet **excluding Ґ, Є, З, І, Ї, Й, О, Ч, Ь**; figures/tables/formulas inside an appendix number as `А.1`, `А.2` (letter replaces chapter number).
  Numbering renders live in the editor and re-flows on reorder/insert/delete. Cross-reference nodes resolve against the same counters, so references never go stale.
- **FR-EDT-08** Caption text conventions (uk locale strings) are centralized and used identically in editor rendering and docx export.

### Persistence

- **FR-EDT-09** Autosave: debounced (~2 s idle) per-section save of ProseMirror JSON + metadata diffs via gateway → service-document. Save status indicator (saved/saving/error with retry). Optimistic concurrency is **per section** (each section record carries its own revision; metadata has a separate revision): stale writes are rejected (`FAILED_PRECONDITION`) and the client reloads that section. Two writers conflict only when editing the same section simultaneously — makes the `editor` role usable for co-writing across different sections.
- **FR-EDT-10** Version snapshots: full document snapshot created (a) manually ("Save version" with a name), (b) automatically before export and before accepting a batch of suggestions, (c) at most once per hour of active editing. Snapshot browser with restore (restore = new snapshot of current state first). Diff view between versions is P-later.
- **FR-EDT-11** Word count / page estimate per section and total (pages estimated from template page setup + average density; labeled as estimate).

## UX notes

- PrimeNG for chrome; the editor surface itself is custom TipTap styling that visually approximates the template (Times New Roman 14pt / 1.5 line spacing look) without claiming WYSIWYG page fidelity — true pagination preview happens via export preview ([09-export.md](09-export.md)).
- Slash-menu (`/`) for block insertion: table, image, formula, citation, cross-reference.
- Keyboard-first: standard shortcuts; Ctrl+S forces snapshot.
- Angular structure: new `features/documents/` feature folder (list + editor); existing `features/projects` mock feature is replaced or repurposed as the documents list.

## Acceptance criteria

- Create document from template → metadata form matches template fields; required sections present, prefilled with template example content.
- All schema nodes survive save/reload round-trip losslessly (JSON equality).
- Renumbering is correct after reordering sections and inserting/removing figures/tables; cross-references update.
- Two concurrent tabs: second writer gets a stale-revision rejection, not silent data loss.

## Open questions

- Extra-section heading styles when a student adds sections beyond the template (use template's Heading style map — likely sufficient).
- Footnotes in MVP (recommend defer).
