# 13 — Roadmap: Phased Delivery

Each phase ends in a demonstrable, testable state. FR references point into the module docs.

## P1 — Foundation: auth unification + gateway + real CRUD

Scope:
- Cleanup: duplicate stubs, Supabase removal, config consolidation, connect-go/connect-es removal + gRPC-web codegen (FR-ARC-11..13, 18).
- Shared Go transport library extensions: client factory, interceptor chain, health, error helpers (FR-ARC-15); service-files migrated to pure gRPC (FR-ARC-00).
- RS256 tokens, refresh rotation, Logout, profile RPCs (FR-AUTH-01..03, 06, 08).
- Client on generated gRPC-web clients: real auth, interceptor registered, guards enabled (FR-AUTH-09..12).
- Gateway implemented as gRPC-web⇄gRPC proxy with auth interceptor + CORS fix (FR-API-14, FR-ARC-00..02).
- Reworked document/template CRUD protos wired end-to-end with SurrealDB definitions (FR-API-06..07 basic subset, FR-DAT-05); documents list UI on real data.

Acceptance: register/login/refresh/logout E2E through gateway; create/list/rename/delete empty documents from the UI; no Supabase or direct backend calls remain.

## P2 — Core loop: template upload/parse → editor → docx export

Scope:
- Shared Python transport library `pkg/shared-py` (gRPC bootstrap mirroring `pkg/shared`) + cross-language parity test (FR-ARC-16..17).
- service-render bootstrapped on it (Python, gRPC, Docker, LibreOffice baked in) (FR-ARC-03).
- Template lifecycle: upload (.doc conversion), parse, diagnostics, review/confirm screen, versioning, seed templates (FR-TPL-01..11).
- Editor: metadata form, TipTap sections with core schema (no formulas/cross-refs yet; **stable block_id attrs from day one** — reserved like suggestion marks, avoids migrations), autosave + **per-section revisions**, numbering/captions for figures/tables incl. **appendix lettering** (FR-EDT-01..05, 07..09).
- Files: unary chunk-upload protocol through gateway (FR-API-13).
- Tables: full editor support + docx mapping with `repeat_header` strategy (FR-TBL-01..08, 10..11).
- Export: docx pipeline (placeholders, sections, tables, images, TOC), async jobs, validation gate, artifacts, PDF conversion + preview (FR-EXP-01..09 minus track-changes strategy).

Acceptance: golden-file suite green; a real department template produces a correctly formatted docx from UI-written content with a 3-page table breaking correctly.

## P3 — Bibliography + polish

Scope:
- Source manager, CSL-JSON model, manual entry, DOI/ISBN/URL autofill (FR-BIB-01..04 minus AI freeform parse).
- Citation nodes, numbering modes, orphan handling (FR-BIB-05..07).
- ДСТУ 8302:2015 CSL style + fixture suite; citeproc rendering in preview and export (FR-BIB-08..11).
- Editor completions from P2 leftovers: formulas (KaTeX/OMML), cross-references, snapshots UI (FR-EDT-06, 10..11).
- `continuation_caption` table strategy (FR-TBL-09).

Acceptance: bibliography fixtures pass for all source types; cite→renumber→export flow correct; formulas render in editor and export.

## P4 — Review mode

Scope:
- Shares: link + email-bound invites, roles, management dialog (FR-REV-01..04).
- Comments: block-id anchors, threads, resolve, orphan handling, badges/read cursors (FR-REV-05..08, 14).
- Suggestions: suggest-mode marks, accept/reject single+bulk, registry, snapshots before bulk (FR-REV-09..12).
- Export strategies: track changes (`w:ins`/`w:del`) + native Word comments (FR-REV-13, FR-EXP-04).

Acceptance: two-account review E2E (NFR-21 subset); exported track changes verified in MS Word.

## P5 — AI

Scope:
- service-ai bootstrapped; provider abstraction with Ollama default + one cloud provider proving pluggability; streaming; limits; kill-switch (FR-AI-01..05).
- Writing assist: draft/continue/transforms with diff-preview apply (FR-AI-06..07).
- Document analysis → AI comments with dedup on re-run (FR-AI-08..10).
- Grammar: LanguageTool tier + LLM style tier (FR-AI-11..12).
- Source assistance: freeform reference parse (closes FR-BIB-04), consistency check, suggestions (FR-AI-13..15).

Acceptance: all four AI feature groups work against local Ollama only; analysis fixture test per [08-ai.md](08-ai.md) acceptance.

## P-later backlog (explicitly deferred)

Password reset & email verification + email notifications (FR-AUTH-07, FR-REV-14); **template markup assistant** (upload raw departmental docx → click-to-mark fields/sections in UI, optional AI candidate detection); **global user-level source library** (reuse sources across documents); **docx draft import** (best-effort docx→ProseMirror for half-written reports, in service-render); footnotes; repeating/loop placeholders; landscape table sections; Word REF fields for cross-refs; version diff view; BibTeX/RIS import; grouped citation authoring UI; metrics; template moderation; appendix page-numbering schemes.

## Dependency notes

- P2 is the critical path and the largest phase; the export translator and template parser can be built in parallel by separate tracks once the TemplateModel/content-schema contracts (docs [03](03-templates.md), [04](04-document-editor.md)) are frozen.
- The suggestion-mark schema (P4) must be reserved in the ProseMirror schema from P2 to avoid content migrations (marks defined but unused until P4).
- ДСТУ CSL style (P3) has no code dependencies and can start anytime as an independent workstream.
