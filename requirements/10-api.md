# 10 — API: Proto Contracts & Gateway

## Purpose

Define the RPC surface changes: extended `document.proto`/`template.proto`, new `render.proto`/`ai.proto`, real gateway implementation, and cross-cutting conventions (auth metadata, errors, pagination).

## Conventions

- **FR-API-01** Contracts live in `proto/`, generated with Buf into `gen/go` (go + go-grpc), `gen/ts` (gRPC-web), `gen/py` (grpcio + typing stubs); connect plugins removed. Buf `STANDARD` lint stays; breaking-change check (`buf breaking`) added to CI against `main`.
- **FR-API-02** **gRPC everywhere** ([01-architecture.md](01-architecture.md) FR-ARC-00): the client calls only the gateway over **gRPC-web** (`:8080`); the gateway translates to pure gRPC and forwards with `user_id` metadata after JWT validation ([02-auth.md](02-auth.md) FR-AUTH-13). All service↔service traffic is gRPC through the shared transport libraries (FR-ARC-15/16). Backends perform authorization (ownership/role checks) — the gateway authenticates, services authorize.
- **FR-API-03** Errors: gRPC status codes + `google.rpc.Status` detail messages (`errdetails`), built/parsed via the shared-library helpers in both languages. Reserved uses: `UNAUTHENTICATED` (bad/expired token), `PERMISSION_DENIED` (role insufficient), `NOT_FOUND`, `ALREADY_EXISTS`, `FAILED_PRECONDITION` (stale revision — carries current revision; export validation — carries violations list), `INVALID_ARGUMENT` (field violations list), `RESOURCE_EXHAUSTED` (AI/rate limits).
- **FR-API-04** List RPCs use page_size/page_token pagination and return `total_count` where cheap. Timestamps are `google.protobuf.Timestamp`. Rich content (ProseMirror JSON, TemplateModel, CSL-JSON) crosses the wire as `string json` fields (schema owned by the app layer, documented in [11-data-model.md](11-data-model.md)) — avoids mirroring deep dynamic structures in proto.

## Service surfaces

### auth.proto (extend)

- **FR-API-05** Existing: Register, Login, LoginWithGoogle, ValidateToken, RefreshToken. Add: `Logout(refresh_token)`, `GetProfile()`, `UpdateProfile(profile)` where profile = name + prefill defaults (university, faculty, department, group, supervisor).

### template.proto (rework)

- **FR-API-06** `TemplateService`: `CreateTemplate(name, description, report_type, file_ref)` (file uploaded via FileService first; create triggers parse in service-render and returns model + diagnostics), `ConfirmTemplate(id, adjusted_model)` (FR-TPL-11), `GetTemplate(id)` (record + current version model), `ListTemplates(filter: own|public, report_type, query, page…)`, `UpdateTemplateMeta(id, name, description, visibility)`, `UploadTemplateVersion(id, file_ref)`, `DeleteTemplate(id)` (forbidden→`FailedPrecondition` if documents reference it; soft-hide instead).

### document.proto (rework)

- **FR-API-07** `DocumentService`: `CreateDocument(template_id, template_version, title)`, `GetDocument(id)` (metadata, sections, settings, my_role), `ListDocuments(filter: own|shared, page…)`, `UpdateMetadata(id, values, metadata_revision)`, `UpdateSection(id, section_id, content_json, section_revision)` (revisions are **per-section** + a separate metadata revision — concurrent editors conflict only within the same section, FR-EDT-09), `AddSection/RemoveSection/ReorderSections`, `DeleteDocument(id)`, `UpdateSettings(id, citation_style, numbering_mode, …)`.
- **FR-API-08** Versions: `CreateSnapshot(id, name)`, `ListSnapshots(id)`, `RestoreSnapshot(id, snapshot_id)`.
- **FR-API-09** Sources: `AddSource(document_id, csl_json, app_fields)`, `UpdateSource`, `DeleteSource`, `ListSources(document_id)`, `ResolveSource(input)` (DOI/ISBN/URL/freeform → draft CSL-JSON; gateway routes to service-render/service-ai).
- **FR-API-10** Review: `ShareByEmail(document_id, email, role)`, `CreateShareLink(document_id, role)`, `RevokeShare(share_id)`, `ListShares(document_id)`, `AcceptShareLink(token)`; `CreateComment/ReplyComment/ResolveComment/DeleteComment/ListComments(document_id, filter)` (comment anchor = `{block_id, offset, text_snapshot}` per FR-REV-05); suggestions ride inside section content (marks) — registry RPCs: `ListSuggestions(document_id)`, `ResolveSuggestion(document_id, suggestion_id, accept|reject, revision)`, `BulkResolveSuggestions(section_id, accept|reject)`.

### render.proto (new)

- **FR-API-11** `RenderService` (stateless; called only by service-document, plus ParseTemplate proxied via gateway on template upload): `ParseTemplate(file_ref) → model+diagnostics`; `RenderDocx(payload) → artifact bytes/object_key` where payload = template file_ref + model + metadata + sections JSON + sources + numbering inputs + options; `ConvertPdf(docx_ref) → pdf_ref`; `RenderBibliography(style_id, sources_csl_json[], numbering_mode) → entries[]` (editor preview).
- **FR-API-11a** Export RPCs live on `DocumentService` (service-document owns the data and orchestrates per FR-ARC-07): `ExportDocument(document_id, options) → job_id`; `GetExportJob(job_id) → status, stage, warnings, artifact_refs`; `ListExports(document_id)`; `PreviewPdf(document_id) → job_id` (FR-EXP-09). service-document assembles the payload, calls RenderService via the shared client factory, stores artifacts via service-files, and tracks job state.

### ai.proto (new)

- **FR-API-12** `AIService` (all document-content ops are server-streaming where generation occurs): `GenerateDraft(context) → stream tokens`, `TransformSelection(text, operation, context) → stream`, `ContinueWriting(context) → stream`, `AnalyzeDocument(document payload) → job / findings[]`, `CheckGrammar(section text, tier) → findings[]`, `ParseReference(raw) → csl_json`, `CheckCitationConsistency(claims+sources) → findings[]`, `GetAIStatus() → enabled, provider, model`.

### file.proto (extend)

- **FR-API-13** Upload/Download/Delete/List kept but the service migrates from Connect-RPC to pure gRPC (FR-ARC-00). gRPC-web supports no client-streaming, so upload is a **unary chunk session**: `BeginUpload(purpose, filename, size, content_type) → upload_id` → repeated `UploadChunk(upload_id, seq, bytes ≤ 2 MB)` → `CompleteUpload(upload_id) → object_key` (server validates declared vs received size, content sniffing, per-purpose limits at complete; sessions expire after 15 min, abandoned parts GC'd). Download = server-streaming RPC (chunked, gRPC-web compatible); add bucket/purpose parameter (`templates|exports|images`) with per-purpose size/type validation, and `GetDownloadURL(object_key)` returning a short-lived presigned URL so binaries don't stream through the gateway.

## Gateway implementation

- **FR-API-14** Replace the `Unimplemented` skeleton with a gRPC-web edge forwarding to backends over gRPC (FR-ARC-01), built on the `pkg/shared` client factory (FR-ARC-15): pooled backend connections; per-RPC timeout defaults (5 s CRUD, 60 s render/AI unary, none for streams); auth interceptor exemption list (FR-ARC-02); CORS fixed to the Angular origin (FR-ARC-10); request logging with user_id + rpc + latency. Server-streaming RPCs (AI token streams, file download) MUST work end-to-end through the gRPC-web translation.

## Acceptance criteria

- `buf lint` + `buf breaking` pass in CI; Go/TS/Py stubs compile.
- Every client feature operates through gateway RPCs only (verified: no direct backend ports referenced in client code).
- Error conventions verified by integration tests: stale revision → `FailedPrecondition` with revision detail; insufficient role → `PermissionDenied`.

## Open questions

- Whether `ValidateToken` RPC remains needed once RS256 local validation lands (likely kept for introspection/debug only).
