# Project Context

## What This Project Is

**university-reports-creator** — a web-based constructor/editor for Ukrainian university academic reports (course works, diploma theses, practice reports). Students write content via a rich web editor; the system guarantees correct formatting per Ukrainian state standards (DSTU 3008:2015 for layout, DSTU 8302:2015 for bibliography).

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Angular 19, PrimeNG 19, TypeScript, Biome (linter) |
| **Backend** | Go 1.25.6 (4 microservices), gRPC, Protobuf |
| **AI Service** | Python 3.12, gRPC, Ollama/OpenAI/Anthropic/OpenRouter |
| **Databases** | PostgreSQL 17 (auth), SurrealDB (documents), MinIO (files) |
| **Infra** | Docker Compose, K3d/Kubernetes, Kustomize, Makefile |

## Architecture

```
Angular Client (:4200) → gRPC-web + JWT
  → service-gateway (:8080) — gRPC-web↔gRPC proxy + auth
    → service-auth      :50051  Go   Users, JWT, Google OAuth
    → service-document  :50052  Go   Documents, Templates (SurrealDB)
    → service-files     :50053  Go   Binary storage (MinIO)
    → service-ai        :50055  Py   AI provider abstraction
```

## Coding Conventions

### Go Services
- Follow standard Go conventions (`gofmt`, `go vet`)
- Use `pkg/shared` for cross-cutting concerns (config, gRPC, auth, interceptors)
- sqlc for Postgres queries, goose for migrations
- Environment-based config via `caarlos0/env`

### Angular Client
- Biome for linting/formatting (not ESLint)
- PrimeNG components preferred over custom UI
- gRPC-web via `@protobuf-ts/grpcweb-transport`
- i18n via `@ngx-translate` (Ukrainian + English)
- Feature modules are lazy-loaded

### Protobuf
- Buf v2 for linting and code generation
- Proto files in `proto/`, generated code in `gen/`
- Use `make proto` to regenerate

### AI Service
- Provider abstraction: Ollama (default), OpenAI, Anthropic, OpenRouter
- LanguageTool for grammar (tier-1), LLM for style (tier-2)
- All prompts in Ukrainian academic style

## Running the Project

```bash
make infra-up        # Start Postgres, SurrealDB, MinIO, service-ai
make dev             # Start all services with hot-reload
make proto           # Regenerate protobuf code
make build           # Build all services
```

---

## Skills

### Always Available

<!-- context7 -->
Use Context7 MCP to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service. This includes Angular, PrimeNG, Go gRPC libraries, SurrealDB, MinIO, Docker, Kubernetes, Protobuf, and any other dependency in this project. Use even when you think you know the answer — training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

## Steps

1. Always start with `resolve-library-id` using the library name and the user's question, unless the user provides an exact library ID in `/org/project` format
2. Pick the best match (ID format: `/org/project`) by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try alternate names or queries. Use version-specific IDs when the user mentions a version
3. `query-docs` with the selected library ID and the user's full question (not single words)
4. Answer using the fetched docs
<!-- context7 -->

### Creative & Design Work

Use **brainstorming** before any creative work — creating features, building components, adding functionality, or modifying behavior. It explores user intent, requirements, and design before implementation. Load it with the skill tool when the task involves building something new or changing user-facing behavior.

### Frontend Development

- **frontend-design** — Use when building Angular components, pages, or UI features. Helps create distinctive, production-grade interfaces that avoid generic AI aesthetics. Load when the user asks to build web components, pages, dashboards, or when styling/beautifying any part of the Angular client.

- **ui-ux-pro-max** — Use for UI/UX design decisions: choosing color schemes, typography, layout systems, interaction patterns, accessibility, responsive behavior. Covers 50+ styles, color palettes, font pairings, and UX guidelines. Load when designing new pages (dashboard, settings, document editor), creating/refactoring UI components, or reviewing UI quality.

- **web-design-guidelines** — Use when reviewing Angular UI code for compliance with web interface best practices. Fetches fresh guidelines from Vercel's web-interface-guidelines before each review. Load when asked to "review UI", "check accessibility", "audit design", or "check against best practices".

### Testing

- **webapp-testing** — Use for Playwright-based testing of the Angular client. Supports verifying frontend functionality, debugging UI behavior, capturing screenshots, and viewing browser logs. Load when the user wants to test, verify, or debug the Angular application. Scripts are in the skill's `scripts/` directory — run `--help` first.

### Discovery

- **find-skills** — Use when you need a capability not listed here (e.g., a specific Go, Protobuf, or Kubernetes skill).

### Project-Specific Skills

These skills are built for this codebase and contain exact patterns, conventions, and domain rules.

- **dstu-formatting** — `skills/dstu-formatting/SKILL.md` — Ukrainian academic document formatting rules. Covers DSTU 3008:2015 (layout: section numbering, figure/table captions, appendix lettering, table continuation) and DSTU 8302:2015 (bibliography: CSL style, citation modes, source types, in-text format). Load when working on document templates, export logic, bibliography/citations, section numbering, or any formatting-related code. This is the project's core domain.

- **proto-workflow** — `skills/proto-workflow/SKILL.md` — Buf v2 protobuf development workflow. Covers proto file conventions, naming rules, enum patterns, streaming patterns, code generation pipeline, and how to add new services/RPCs. Load when creating or modifying `.proto files, adding RPCs, generating code, or linting protos.

- **go-microservice** — `skills/go-microservice/SKILL.md` — Go microservice architecture patterns. Covers the exact main.go bootstrap, gRPC service implementation, repository patterns (PostgreSQL/sqlc, SurrealDB, MinIO), error handling, config loading, interceptor chains, gateway proxy pattern, and the shared library. Load when creating or modifying Go backend services, implementing gRPC handlers, writing repositories, or working with `pkg/shared/`.

- **angular-client** — `skills/angular-client/SKILL.md` — Angular 19 client patterns. Covers standalone component conventions, signal-based service state, the shared gRPC-web transport + auth-retry pattern, streaming RPC consumption, guards/routing, and i18n. Load when creating or modifying components, services, or routes in `client/src/app`.

- **service-ai-provider** — `skills/service-ai-provider/SKILL.md` — Python service-ai patterns. Covers the `LLMProvider` abstraction, adding a new provider, the gRPC servicer method pattern (rate limiting, streaming cancellation, defensive JSON parsing), and config loading. Load when adding/modifying LLM providers, gRPC handlers, prompts, or config in `service-ai/src/ai`.

- **document-editor** — `skills/document-editor/SKILL.md` — TipTap/ProseMirror editor patterns for the section-based document editor. Covers the one-editor-per-section architecture, custom schema extensions (block IDs, numbering, captioned tables/figures), the pure `computeNumbering()` layer, and autosave/revision handling. Load when working on `client/src/app/features/documents/editor`. Pairs with `dstu-formatting` for the numbering rules it implements.

- **commit-workflow** — `skills/commit-workflow/SKILL.md` — This repo's actual git practice: trunk-based (no branches/PRs), Conventional Commits with no body, scope = directory name. Load when committing a batch of changes or splitting a mixed working tree into commits.
