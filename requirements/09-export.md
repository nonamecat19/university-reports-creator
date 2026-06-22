# 09 — Export Pipeline (docx primary, PDF optional)

## Purpose

Export merges document content into the **original template docx** in service-render, preserving department formatting exactly. PDF is an optional derivative produced from the exported docx via LibreOffice headless — never a separate rendering path, so docx and PDF can't diverge.

## Pipeline

```
ExportDocument RPC (gateway → service-document)
  → service-document orchestrates (FR-ARC-07): collects template docx ref (MinIO) +
    TemplateModel + document (metadata, sections PM-JSON, sources, suggestions) +
    export options into a render payload, creates the job, calls RenderDocx
  → service-render (stateless):
      1. open original template docx (python-docx / raw OOXML layer)
      2. substitute scalar placeholders {{field}} in body/headers/footers (run-aware, FR-TPL-06)
      3. replace each {{#section}} region with content translated from ProseMirror JSON
      4. render bibliography at {{bibliography}} via citeproc (06)
      5. apply suggestion/comment strategy (07 FR-REV-13)
      6. TOC: refresh/insert field, set updateFields on open
      7. post-passes: numbering/captions/cross-refs, table pagination strategy (05)
      8. optional: LibreOffice headless docx → PDF
  → service-document stores artifact in MinIO exports/, marks job done with download URL
```

## Functional requirements

### Content translation (ProseMirror JSON → OOXML)

- **FR-EXP-01** service-render implements a deterministic translator for every schema node ([04-document-editor.md](04-document-editor.md) FR-EDT-04):
  - paragraphs/headings → paragraphs with the **template's** style ids from the style_map (Heading 2–4, Normal); no direct formatting for typography — styles only, so output obeys the department file;
  - appendix sections (`kind: appendix`, FR-EDT-07) → «Додаток А» headings with the ДСТУ letter sequence and А.1-style figure/table/formula numbering inside them;
  - lists → template numbering definitions (or cloned defaults) with proper `numId`/`ilvl`;
  - tables → per [05-tables.md](05-tables.md) FR-TBL-07..10;
  - images → embedded media with `wp:inline` drawing, EMU size from natural size capped to text-column width, caption paragraph per FR-EDT-08 (caption style if template defines one);
  - formulas → OMML (LaTeX→OMML), fallback PNG render with a warning;
  - citation nodes → literal `[N]` text per numbering mode; cross-reference nodes → resolved literal text ("рис. 2.1") — plain text, not Word REF fields, in MVP;
  - suggestion marks → `w:ins`/`w:del`, comments → `w:comment*` parts, per selected strategy.
- **FR-EXP-02** Numbering/caption computation reuses the exact same counter rules as the editor (single spec, two implementations, shared fixture suite) so what the student sees matches the file.
- **FR-EXP-03** TOC: if the template contains a native TOC field it is preserved; if `{{toc}}` marker is present a `TOC \o "1-3" \h \z \u` field is inserted; either way `w:updateFields` is set in settings.xml so Word/LibreOffice refresh page numbers on open. For the PDF path, LibreOffice performs field update before conversion so the PDF TOC has real page numbers.

### Options, jobs, artifacts

- **FR-EXP-04** Export options: format (`docx` | `docx+pdf`), suggestions strategy (`with_track_changes` default when pending / `clean` / `all_accepted`), include comments (bool), table continuation strategy ([05](05-tables.md) FR-TBL-09).
- **FR-EXP-05** Export runs as an **async job owned by service-document** (RPCs on DocumentService — FR-API-11a): `ExportDocument` returns job id; `GetExportJob` polls status (`queued/running/done/failed` + stage + warnings). Client shows progress and a download button on completion. Target p50 < 10 s for a 50-page document excluding PDF, < 25 s with PDF ([12-non-functional.md](12-non-functional.md)).
- **FR-EXP-06** Pre-export validation gate (client + server): required metadata fields empty, required sections empty, orphaned citations, table lint findings — plus deterministic ДСТУ preflight: figures/tables never referenced from text (no cross-reference node points at them), per-section word-count targets when the template defines an optional `min_words` section attr. Blocking errors vs. warnings listed in a checklist dialog; server re-validates (`FAILED_PRECONDITION` with structured violations).
- **FR-EXP-07** Artifacts stored in MinIO `exports/{document_id}/{job_id}/` with filename convention `{surname}_{report_type}_{topic-slug}_{yyyy-mm-dd}.docx|pdf` (transliterated, length-capped). Retained last 10 exports per document; older auto-pruned. A version snapshot is taken at export time (FR-EDT-10) and linked to the job.
- **FR-EXP-08** Failure handling: any stage error → job `failed` with a user-readable message + machine detail (stage, cause); LibreOffice conversion failure still delivers the docx (PDF marked failed separately). All temp files cleaned per job.
- **FR-EXP-09** **Export preview**: "Preview PDF" action runs the same pipeline (clean strategy) to PDF and displays it in-browser — this is the pagination-accurate preview referenced in [04](04-document-editor.md) UX notes.

## Acceptance criteria

- Golden-file suite: fixture template + fixture document → exported docx compared structurally (unzipped XML, normalized) against approved goldens; opens without repair prompts in Word and LibreOffice.
- Placeholders in headers/footers substituted; department styles (fonts, margins, spacing) in output are byte-inherited from the template, not reconstructed.
- TOC in the PDF shows correct page numbers; docx TOC refreshes correctly on open.
- Export with pending suggestions produces working native track changes; `clean` strategy contains none.
- Two consecutive exports of the same document are byte-identical except timestamps (determinism).

## Open questions

- Word REF fields for cross-references instead of literal text (upgrade path; literal is safer for LibreOffice fidelity in MVP).
- Appendices with per-appendix page numbering schemes — P-later.
