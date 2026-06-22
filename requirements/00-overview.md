# 00 — Project Overview

## Purpose

**university-reports-creator** is a web-based constructor for university academic reports — course works (курсова робота), diploma theses (дипломна робота), and practice reports (звіт з практики). Students assemble a report from a **docx template** provided by their department, write content in a structured web editor, and export a finished, correctly formatted **docx** file (optionally PDF) that matches the department's formatting requirements (ДСТУ 3008:2015 layout conventions, ДСТУ 8302:2015 bibliography).

The core value proposition: the student focuses on content; the system guarantees formatting — title page, section numbering, table layout and page-break behavior, figure/table captions, and an auto-generated, correctly ordered reference list.

## Target users

| Role | Description |
|---|---|
| **Student (owner)** | Creates documents from templates, writes content, manages sources, exports docx/PDF. Owns the document and controls sharing. |
| **Reviewer (supervisor)** | Receives a share link or email invite. Reads the document, leaves anchored comments, and proposes suggestions (track-changes style) that the student accepts or rejects. Does not need a heavyweight account flow. |

There is **no university/department/group hierarchy** in scope. Sharing is per-document (Google Docs-like model). See [07-review-mode.md](07-review-mode.md).

## Report types

All three types share the same machinery; they differ only in template structure:

1. **Course work** — title page, task sheet, abstract, TOC, intro, 2–4 chapters, conclusions, references, appendices.
2. **Diploma thesis** — same plus extended front matter (task assignment, calendar plan, abstract in two languages).
3. **Practice report** — title page, individual task, diary/log tables (ordinary editor tables, no special template machinery), content sections, conclusions, references.

## Key features

1. **docx-first templates** — departments distribute formatting requirements as doc/docx files. The system ingests a docx template with placeholders, extracts its styles and structure, and exports by merging user content back into that template so the output preserves the department's exact formatting. ([03-templates.md](03-templates.md))
2. **Hybrid document editor** — fixed metadata fields (university, student name, topic, supervisor…) filled via forms + rich-text sections (ProseMirror/TipTap) for body text with tables, images, formulas, citations, and cross-references. ([04-document-editor.md](04-document-editor.md))
3. **Tables that survive export** — resizable columns in the editor, widths preserved in docx, correct page-break continuation with repeated header rows and "Продовження таблиці N" convention. ([05-tables.md](05-tables.md))
4. **Generated bibliography** — source manager with autofill (DOI/ISBN/URL), CSL-based rendering, ДСТУ 8302:2015 as the primary style, auto-numbered in-text citations kept in sync with the reference list. ([06-bibliography.md](06-bibliography.md))
5. **Review mode** — Google-Docs-like asynchronous review: anchored comment threads and accept/reject suggestions; suggestions export as native Word track changes. ([07-review-mode.md](07-review-mode.md))
6. **AI assistance** — local-first (Ollama) with pluggable cloud providers: text generation/rewriting, whole-document analysis emitted as review comments, Ukrainian grammar/style checking, source assistance. ([08-ai.md](08-ai.md))
7. **Export** — docx as the primary target (template merge in a Python render service), PDF as an optional derivative via LibreOffice headless. ([09-export.md](09-export.md))

## Existing foundation

The repo is a partially built monorepo (see [01-architecture.md](01-architecture.md) for the full inventory):

- Go microservices: `service-auth` (custom JWT + Postgres), `service-document` (SurrealDB CRUD), `service-files` (MinIO), `service-gateway` (currently an unimplemented skeleton; target: gRPC-web edge over pure-gRPC backends — see [01-architecture.md](01-architecture.md) FR-ARC-00).
- Contracts in `proto/` generated with Buf into `gen/go` and `gen/ts`.
- Angular 19 client (`client/`) with PrimeNG, Signals, feature folders, currently on mock data and Supabase auth (to be removed — [02-auth.md](02-auth.md)).
- Infra: docker-compose (Postgres, SurrealDB, MinIO), Air hot reload, k8s Kustomize overlays, Makefile.

## Glossary

| Term | Meaning |
|---|---|
| ДСТУ 3008:2015 | Ukrainian state standard for the structure and layout of scientific/technical reports (margins, numbering of sections/figures/tables, caption conventions). |
| ДСТУ 8302:2015 | Ukrainian state standard for bibliographic references (the required style for the reference list in most Ukrainian universities). |
| CSL | Citation Style Language — XML-based citation style definitions consumed by citeproc engines. |
| Template | A department docx file with placeholders, ingested and parsed into a template model. |
| Document | A student's report instance created from a template: metadata values + section contents + sources + review data. |
| Placeholder | A `{{name}}` marker inside the template docx that is replaced at export time. |
| Suggestion | A proposed edit created in review mode, pending accept/reject; exports as Word track changes. |
| OOXML | Office Open XML — the docx file format (`w:` namespace elements referenced throughout these docs). |

## Out of scope (explicitly)

- Real-time collaborative editing (CRDT/Yjs, live cursors). Review is asynchronous.
- University/department/group administration hierarchy and teacher-managed template catalogs.
- Plagiarism detection.
- doc (binary Word 97) export — ingest of `.doc` is handled by converting to docx on upload; export is docx/PDF only.
- Mobile applications (responsive web only).
- Payments/quotas.

## Requirements documents index

| File | Module |
|---|---|
| [01-architecture.md](01-architecture.md) | System architecture, services, infra |
| [02-auth.md](02-auth.md) | Authentication & user accounts |
| [03-templates.md](03-templates.md) | docx template ingestion & model |
| [04-document-editor.md](04-document-editor.md) | Document model & editor |
| [05-tables.md](05-tables.md) | Tables (editor + docx mapping) |
| [06-bibliography.md](06-bibliography.md) | Sources & bibliography |
| [07-review-mode.md](07-review-mode.md) | Sharing, comments, suggestions |
| [08-ai.md](08-ai.md) | AI assistance |
| [09-export.md](09-export.md) | docx/PDF export pipeline |
| [10-api.md](10-api.md) | Proto/RPC contracts & gateway |
| [11-data-model.md](11-data-model.md) | Persistence schemas |
| [12-non-functional.md](12-non-functional.md) | NFRs: performance, security, i18n |
| [13-roadmap.md](13-roadmap.md) | Phased delivery plan |
