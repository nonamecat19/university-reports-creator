# 12 — Non-Functional Requirements

## Performance

- **NFR-01** Editor: keystroke-to-render < 16 ms typical section (< 5k words); section open < 300 ms; autosave RPC p95 < 500 ms.
- **NFR-02** Export ([09](09-export.md)): p50 < 10 s / p95 < 30 s for a 50-page document (docx only); +15 s budget for PDF conversion. Template parse < 5 s for a 20 MB docx.
- **NFR-03** AI: first streamed token < 3 s (local Ollama on recommended hardware); tier-1 grammar (LanguageTool) < 2 s per section; whole-document analysis is a background job, no hard limit but progress-reported.
- **NFR-04** Bibliography re-render (citeproc) after source change < 500 ms for 100 sources.

## Limits

- **NFR-05** Uploads: template docx ≤ 20 MB; image ≤ 10 MB (png/jpeg/svg only, content-sniffed not extension-trusted); chunked upload sessions (FR-API-13): chunk ≤ 2 MB, session TTL 15 min, abandoned sessions GC'd. Document: ≤ 100 sections, ≤ 200k words total, ≤ 200 sources, ≤ 150 images. Exceeding → `InvalidArgument`/`ResourceExhausted` with clear messages.
- **NFR-06** Rate limits at gateway: general RPC 20 rps/user burst 50; AI 2 concurrent + 10/min per user (FR-AI-05); export 3 concurrent jobs per user.

## Security

- **NFR-07** JWT per [02-auth.md](02-auth.md): RS256, 15 min access / 30 d rotating refresh (hashed at rest, family revocation). All secrets via env, never committed; `.env.example` documents every variable. The Supabase keys currently hardcoded in `client/src/environments/environment.ts` are removed (FR-ARC-12) and the exposed anon key rotated/deactivated in the Supabase project.
- **NFR-08** Share links: ≥ 128-bit random tokens, stored hashed (FR-DAT-03), revocable; possession grants only the link's role on one document.
- **NFR-09** File safety: uploaded docx validated as ZIP/OOXML before parsing; macros (`vbaProject.bin`), ActiveX, OLE objects and external-content relationships stripped on ingest (FR-TPL-10); parsers hardened against zip bombs (decompressed-size cap) and XML entity expansion (defused XML parsing in Python).
- **NFR-10** Authorization on every RPC in services (gateway authenticates only) — role matrix per [07-review-mode.md](07-review-mode.md); IDOR tests are part of the integration suite (user B cannot read/write user A's document by id).
- **NFR-11** MinIO access only via services/presigned URLs (short-lived, ≤ 10 min); buckets not publicly readable. TLS terminated at ingress in k8s; internal traffic on cluster network.
- **NFR-12** AI privacy per FR-AI-04: local-first default; explicit consent gate before any cloud provider; no document content in logs anywhere (all services).

## Internationalization

- **NFR-13** UI languages: **uk (default)** and en, via Angular i18n or ngx-translate (single mechanism, no hardcoded strings in components). Generated-document locale strings (Рисунок/Таблиця/Продовження таблиці/bibliography terms) come from the export/bibliography spec and are independent of UI language.
- **NFR-14** Full Unicode/cyrillic correctness end-to-end: filenames (transliteration per FR-EXP-07), docx text, search, CSL rendering.

## Observability & operations

- **NFR-15** Structured logging in every service (Go slog pattern extended to Python: JSON lines, request id, user_id, rpc, latency, code). Request id generated at gateway, propagated via metadata.
- **NFR-16** Health endpoints (`/healthz` liveness, readiness incl. dependency ping) on all services; wired into k8s probes and docker-compose healthchecks.
- **NFR-17** Metrics P-later; MVP relies on logs. Error budget: export job failure rate < 2% on golden corpus.

## Development experience

- **NFR-18** `make infra-up && make dev-all` (or equivalent per-service dev targets incl. Python services with hot reload) brings up the entire stack locally, Ollama included; a `make seed` loads demo user, seed templates (FR-TPL UX) and a demo document.
- **NFR-19** CI: buf lint+breaking, Go build+test, Python lint (ruff)+test (pytest), client lint (Biome)+test, golden-file export suite ([09](09-export.md)), ДСТУ CSL fixtures ([06](06-bibliography.md)).

## Testing expectations

- **NFR-20** Coverage priorities (in order): export translator golden files; ДСТУ bibliography fixtures; template parser (fixtures incl. run-fragmented placeholders, headers/footers, malformed files); numbering/cross-ref counter spec (shared TS/Py fixture suite per FR-EXP-02); auth flows incl. refresh rotation/reuse; review role matrix / IDOR; suggestion accept-reject correctness; table docx mapping; per-section revision conflicts (two writers, same/different sections); block-id anchor stability across reorders/edits.
- **NFR-21** E2E smoke (Playwright): register → create template from seed docx → create document → write section with table+citation → share to second user → comment+suggest → accept → export with track changes → artifact downloads.

## Browser support

- **NFR-22** Evergreen Chrome/Firefox/Edge, latest two versions; desktop-first responsive (≥ 1280 px optimal, usable at 1024 px). No mobile editing guarantee.
