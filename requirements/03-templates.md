# 03 — docx Template Ingestion & Model

## Purpose

Templates are always **doc/docx** files — the format departments actually distribute. The system ingests an uploaded docx with placeholders, parses it into a structured template model (metadata fields + section skeleton + style map), and uses the original file at export time so output preserves the department's exact formatting.

## Template lifecycle

```
upload .doc/.docx ──► (doc → docx convert, LibreOffice) ──► parse (service-render)
      │                                                        │
      ▼                                                        ▼
 original stored in MinIO                       parsed TemplateModel stored in SurrealDB
                                                               │
                                              document created FROM template (04)
                                                               │
                                              export merges content INTO original (09)
```

## Functional requirements

### Upload & storage

- **FR-TPL-01** User uploads `.docx` or `.doc` (max 20 MB). `.doc` is converted to `.docx` via LibreOffice headless in service-render before parsing; only the converted docx is kept.
- **FR-TPL-02** Original docx stored in MinIO bucket `templates/` keyed by template id + version; parsed `TemplateModel` stored in SurrealDB (see [11-data-model.md](11-data-model.md)). Template record: id, owner_id, name, description, report_type (course/diploma/practice/other), created_at, version.
- **FR-TPL-03** Templates are versioned: re-uploading a file to an existing template creates a new version; existing documents keep referencing the version they were created from. No in-place mutation of a parsed model that documents depend on.
- **FR-TPL-04** Template visibility: `private` (owner only) or `public` (listed in a shared catalog for all users). Default private. Public catalog supports search by name and filter by report_type.

### Placeholder syntax

- **FR-TPL-05** Placeholders inside the docx body, headers, and footers:
  - `{{field_name}}` — scalar metadata field (e.g. `{{student_name}}`, `{{topic}}`, `{{year}}`).
  - `{{field_name|label=Тема роботи|required|default=...}}` — optional inline attributes: human label, required flag, default value. Attribute-less placeholders get a label auto-generated from the name.
  - `{{#section:intro|label=Вступ|required}} ... {{/section}}` — marks a region as an editable rich-text section; the region's own content in the template becomes the section's placeholder/example text. Region markers MUST be in paragraphs of their own. Optional attrs: `kind=appendix` (section numbers as Додаток А/Б… per FR-EDT-07), `min_words=N` (word-count target enforced as a preflight warning, FR-EXP-06).
  - `{{bibliography}}` — insertion point for the generated reference list ([06-bibliography.md](06-bibliography.md)).
  - `{{toc}}` — insertion point for a TOC field (or the template may already contain a native Word TOC field, which is preserved and marked dirty for refresh — see [09-export.md](09-export.md)).
- **FR-TPL-06** Placeholders split across multiple OOXML runs (Word habitually fragments text into runs) MUST be detected and normalized during parsing — matching operates on concatenated paragraph text, then run boundaries are repaired.
- **FR-TPL-07** Well-known field names (`student_name`, `university`, `faculty`, `department`, `group`, `supervisor`, `topic`, `city`, `year`) map to typed fields and are prefilled from the user profile (FR-AUTH-08). Unknown names become plain text fields.

### Parsing (service-render)

- **FR-TPL-08** `ParseTemplate` RPC: input docx bytes/object key → output `TemplateModel`:
  - `fields[]`: name, label, type (text/multiline/date/number/select), required, default, occurrences (body/header/footer).
  - `sections[]`: id, label, order, required, heading level & style at the marker location, example content extracted from the region (converted to ProseMirror JSON for editor prefill).
  - `style_map`: named styles present in the docx relevant to content mapping — paragraph styles (Normal, Heading 1..6, caption, list), character styles, default table style, with resolved effective properties (font, size, alignment, spacing, indents).
  - `page_setup`: page size, margins, orientation per docx section (`w:sectPr`).
  - `numbering`: extracted `numbering.xml` definitions relevant to lists used in mapped styles.
  - `warnings[]`: non-fatal issues found (see FR-TPL-10).
- **FR-TPL-09** Parsing MUST NOT lose the original file — the model is an index over it, not a replacement. Export starts from the original bytes (see [09-export.md](09-export.md)).

### Validation & errors

- **FR-TPL-10** Parse produces machine-readable diagnostics, each with severity and location (paragraph index / header/footer part):
  - errors (reject upload): unreadable/corrupt file, password-protected, unbalanced `{{#section}}`/`{{/section}}`, duplicate section ids;
  - warnings (accept, show to user): placeholder-like text that didn't parse (`{{ foo`), fields used in header only, no `{{bibliography}}` marker, no sections defined (document degenerates to metadata-only), unsupported embedded objects (ActiveX, macros — stripped).
- **FR-TPL-11** After upload the client shows a **template review screen**: detected fields (editable labels/types/required), section list, warnings. User confirms before the template becomes usable. Confirmed adjustments are stored in the TemplateModel (they never modify the docx).

## UX notes

- Templates list page already exists in the client (`features/templates`); replace mock `TemplateService` data with gateway RPCs.
- Field type/label editing on the review screen reuses the existing `TemplateField` frontend model (`client/src/app/shared/models/template.model.ts`) where it fits.
- Provide 2–3 built-in seed templates (course/diploma/practice per ДСТУ 3008:2015) shipped as real docx files with placeholders, both as fixtures for tests and as the public catalog's initial content.

## Acceptance criteria

- Uploading a real department docx with `{{...}}` markers yields a correct field list and section skeleton, including placeholders split across runs and placeholders in headers/footers.
- `.doc` upload works via conversion; corrupt/protected files produce a clear error.
- A document created from template version N is unaffected by uploading version N+1.
- Round-trip fidelity: export of an empty document (defaults only) from a template produces a docx visually identical to the original with placeholders substituted.

## Open questions

- Whether public templates need moderation (MVP: no; any user can publish).

## Non-goals (resolved)

- **Loop/repeating placeholders are NOT needed for MVP.** Practice-report diaries/logs are ordinary editor tables inside a `{{#section}}` region — the student adds rows manually ([05-tables.md](05-tables.md) covers export). Only `{{#section}}` regions and scalar fields exist in the placeholder syntax. A future markup assistant (click-to-mark raw docx, optional AI candidate detection) is in the P-later backlog ([13-roadmap.md](13-roadmap.md)).
