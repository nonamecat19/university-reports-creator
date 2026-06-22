# 11 — Data Model & Persistence

## Purpose

Field-level schemas across the three stores: **Postgres** (users/auth), **SurrealDB** (all document-domain data), **MinIO** (binaries). Documents keep SurrealDB (existing choice); its flexible records fit ProseMirror JSON and evolving review structures.

## Postgres (service-auth)

```sql
users (
  id UUID PK, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  hashed_password TEXT NULL,          -- NULL for Google-only accounts
  google_sub TEXT UNIQUE NULL,
  email_verified BOOL DEFAULT false,  -- reserved (FR-AUTH-07)
  -- profile prefill defaults (FR-AUTH-08)
  university TEXT, faculty TEXT, department TEXT, student_group TEXT, supervisor TEXT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
refresh_tokens (
  id UUID PK, user_id UUID FK, token_hash TEXT NOT NULL,
  family_id UUID NOT NULL,            -- rotation family (FR-AUTH-02)
  expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ
)
```

Managed by goose migrations (existing setup); queries via sqlc (FR-ARC-13).

## SurrealDB (service-document) — ns `diploma`, db `main`

Cross-store references to users are plain `user_id: string` (UUID from Postgres); services enrich with names via service-auth when displaying. Record ids use Surreal `table:uuid` form.

### template
```
template: id, owner_id, name, description, report_type (course|diploma|practice|other),
          visibility (private|public), current_version: int,
          created_at, updated_at
template_version: id, template_id, version: int, file_key (MinIO),
          model: object {            # parsed TemplateModel (FR-TPL-08)
            fields[], sections[], style_map, page_setup, numbering, warnings[]
          },
          confirmed: bool, created_at
```

### document
```
document: id, owner_id, template_id, template_version: int, title,
          metadata: object { field_name -> value },
          settings: { citation_style, numbering_mode (by_order|alphabetical),
                      include_uncited: bool, table_continuation (repeat_header|continuation_caption) },
          metadata_revision: int,     # optimistic concurrency for metadata/settings (FR-EDT-09)
          created_at, updated_at
section:  id, document_id, template_section_id | null (extra sections), title,
          kind (chapter|appendix), order: int, required: bool,
          revision: int,              # per-section optimistic concurrency (FR-EDT-09)
          content: object,            # ProseMirror JSON (schema per FR-EDT-04: every block
                                      #   node carries stable block_id UUID attr;
                                      #   incl. suggestion marks per FR-REV-11)
          updated_at
```

### bibliography
```
source: id, document_id, csl: object (CSL-JSON), language (uk|en|other),
        raw_input: string, fill_status (manual|auto|needs_review),
        access_date, include_uncited_override: bool, created_at
# citation occurrences are NOT stored here — they live as citation nodes in section
# content; numbering is computed (FR-BIB-05/06)
```

### review
```
share:   id, document_id, kind (email|link), role (viewer|commenter|editor),
         user_id | null (bound on accept), email | null, link_token_hash | null,
         revoked_at | null, created_at
comment: id, document_id, section_id, thread_root_id | null (replies),
         author (user_id | "ai"), ai_category | null,
         anchor: { block_id, offset_from, offset_to, text_snapshot },   # FR-REV-05/06
         orphaned: bool, body: string,
         resolved_at | null, resolved_by | null, created_at
suggestion_registry: id, document_id, section_id, suggestion_id (matches marks),
         author_id, kind (insert|delete|format), status (pending|accepted|rejected),
         created_at, resolved_at | null
read_cursor: id, document_id, user_id, last_seen_at        # FR-REV-14 badges
```

### versions & exports
```
snapshot: id, document_id, name | null, trigger (manual|export|bulk_accept|auto),
          data: object,               # full document+sections+sources state
          created_at
export_job: # owned and written by service-document, which orchestrates render (FR-ARC-07)
          id, document_id, snapshot_id, requested_by,
          options: { format, suggestions_strategy, include_comments, table_continuation },
          status (queued|running|done|failed), stage, warnings[],
          artifacts: [{ kind (docx|pdf), file_key, filename }],
          error | null, created_at, finished_at
```

## MinIO buckets

| Bucket | Content | Key convention | Lifecycle |
|---|---|---|---|
| `templates` | template docx versions | `{template_id}/v{n}.docx` | kept while template exists |
| `images` | editor-embedded images | `{document_id}/{uuid}.{ext}` | orphans GC'd when document deleted |
| `exports` | export artifacts | `{document_id}/{job_id}/{filename}` | last 10 jobs per document (FR-EXP-07) |

## Integrity & conventions

- **FR-DAT-01** Referential integrity across stores is application-enforced: deleting a document cascades sections/sources/comments/suggestions/snapshots/export jobs (Surreal) and its MinIO objects; deleting a user is out of MVP scope (documents reference user_id forever).
- **FR-DAT-02** Revisions are per-record: a section write bumps that section's `revision`, a metadata/settings write bumps `document.metadata_revision` — each atomically with the write (Surreal transaction), rejecting stale revisions (`FAILED_PRECONDITION` carrying the current value). Writers to different sections never conflict.
- **FR-DAT-03** `link_token` stored only as hash (like refresh tokens); raw token exists only in the generated URL.
- **FR-DAT-04** Snapshots are full copies, not diffs — storage-inefficient but simple and restore-safe; the FR-EDT-10 caps bound growth. Revisit if size becomes a problem.
- **FR-DAT-05** SurrealDB schema defined as SCHEMAFULL where shapes are stable (template, share, export_job) and SCHEMALESS for `content`/`model`/`csl` objects; definitions checked into `service-document/sql/` equivalents and applied on startup (idempotent DEFINE statements).

## Acceptance criteria

- Fresh `docker compose up` + service start provisions all definitions idempotently.
- Cascade delete of a document leaves zero orphans across SurrealDB and MinIO (integration test).
- Stale-revision write is rejected under concurrent section updates (test with two writers).
