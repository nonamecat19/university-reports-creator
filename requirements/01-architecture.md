# 01 — System Architecture

## Purpose

Define the target service topology, how new capabilities (docx processing, AI) fit into the existing Go/Angular monorepo, and the cleanup needed to get there.

## Current state (inventory)

| Component | Location | Stack | State |
|---|---|---|---|
| service-auth | `service-auth/` | Go, gRPC `:50051`, Postgres (goose migrations), custom JWT (`golang-jwt/v5`), bcrypt, Google token verification | Working: Register, Login, LoginWithGoogle, ValidateToken, RefreshToken |
| service-document | `service-document/` | Go, gRPC `:50052`, SurrealDB (`ws://localhost:8000`, ns `diploma`, db `main`) | CRUD only; Document/Template entities are `{id, name, content}` strings |
| service-files | `service-files/` | Go, Connect-RPC over HTTP `:50053`, MinIO | Upload/Download/Delete/List working — **to migrate to pure gRPC (FR-ARC-00)** |
| service-gateway | `service-gateway/` | Go, Connect-RPC HTTP `:8080`, rs/cors | **Skeleton: every handler returns `CodeUnimplemented`; to be rebuilt as gRPC-web edge (FR-ARC-01)** |
| client | `client/` | Angular 19, PrimeNG 19, Signals, Biome | UI shell + mock data; Supabase auth (to be removed) |
| shared | `pkg/shared/` | Go: generic env config (`config.Load[T]`), gRPC server wrapper with graceful shutdown, logging interceptor | Reused by all Go services |
| contracts | `proto/{auth,document,file,template}` | Buf v2 → `gen/go` (go, go-grpc, connect-go), `gen/ts` (connect) | Working codegen |
| infra | `docker-compose.yml`, `k8s/`, `Makefile`, Air configs | Postgres 17, SurrealDB, MinIO; k3d Kustomize overlays | Working local dev |

## Target architecture

```
Angular client (:4200)
    │  gRPC-web (browser transport) + JWT
    ▼
service-gateway (:8080)  ── gRPC-web ⇄ gRPC translation + auth interceptor (JWT via public key)
    │ proxies to backends over pure gRPC (HTTP/2)
    ├── service-auth      :50051  Go   · users, JWT, Google OAuth      · Postgres
    ├── service-document  :50052  Go   · documents, templates(meta),   · SurrealDB
    │         │                          comments, suggestions, shares,
    │         │                          sources, versions; orchestrates
    │         └──gRPC──► service-render   export jobs (FR-ARC-07)
    ├── service-files     :50053  Go   · binary storage                · MinIO
    ├── service-render    :50054  Py   · docx parse / docx merge /     · stateless
    │                                    PDF convert / CSL rendering     (LibreOffice, citeproc)
    └── service-ai        :50055  Py   · AI provider abstraction       · Ollama (default)
                                         generation/analysis/grammar     + pluggable cloud APIs
```

### Protocol: gRPC everywhere

- **FR-ARC-00** **gRPC is the single RPC protocol for all services.** Every backend (Go and Python) runs a pure gRPC server (HTTP/2, protobuf binary). The only non-gRPC surface in the system is the gateway's browser edge, which speaks **gRPC-web** (browsers cannot carry native gRPC trailers) and translates 1:1 to internal gRPC. Consequences:
  - `service-files` migrates from Connect-RPC to pure gRPC. gRPC-web constraint: browsers get unary + server-streaming only — Download = server-streaming, Upload = unary chunk session (FR-API-13); no client/bidi streaming anywhere on the browser path;
  - `connect-go`/`connect-es` codegen is dropped; TS clients are gRPC-web;
  - the two Python services are gRPC (`grpc.aio`) servers from day one.

### Functional requirements

- **FR-ARC-01** `service-gateway` MUST be implemented as a real proxy: a gRPC-web edge (in-process gRPC-web wrapper, e.g. `improbable-eng/grpc-web` Go wrapper, or Envoy gRPC-web filter as the k8s alternative) forwarding each RPC to the corresponding backend over gRPC (dial addresses from `SERVICE_AUTH`, `SERVICE_DOCUMENT`, `SERVICE_FILES`, `SERVICE_RENDER`, `SERVICE_AI` env vars). The current `CodeUnimplemented` stubs are replaced. The client talks **only** to the gateway.
- **FR-ARC-02** The gateway MUST apply a unary auth interceptor to all RPCs except `AuthService.{Register,Login,LoginWithGoogle,RefreshToken}` and public share-link resolution (see [07-review-mode.md](07-review-mode.md)). The interceptor validates the JWT locally (shared signing key/JWKS) and injects `user_id` into outgoing request metadata for backends.
- **FR-ARC-03** Two new Python services are added to the monorepo, each with the same operational contract as Go services: gRPC server (`grpc.aio`), `.env`/`.env.example` config, health endpoint, graceful shutdown on SIGINT/SIGTERM, structured JSON logging, Dockerfile, k8s manifests in `k8s/base` + overlays, and Makefile targets (`build-render`, `dev-render`, etc.). All of this comes from the shared Python library (FR-ARC-16), not per-service boilerplate.
  - **service-render** — docx template parsing, docx export merge, PDF conversion (LibreOffice headless in the same container), CSL bibliography rendering. Stateless: receives/returns bytes or MinIO object keys.
  - **service-ai** — provider-abstracted LLM operations. See [08-ai.md](08-ai.md).
- **FR-ARC-04** Proto contracts remain the single source of truth in `proto/`; Buf generates Go (`protoc-gen-go` + `protoc-gen-go-grpc`), TS (**gRPC-web** clients), **and Python** (`grpcio-tools`/`protoc-gen-grpc-python` + typing stubs) into `gen/go`, `gen/ts`, `gen/py`. connect-go/connect-es plugins are removed from `buf.gen.yaml`. New files: `proto/render/render.proto`, `proto/ai/ai.proto`; extended: `document.proto`, `template.proto`. See [10-api.md](10-api.md).
- **FR-ARC-05** docker-compose gains: `ollama` (with a named volume for models), and service-render's LibreOffice is baked into its image, not a separate container. Existing Postgres/SurrealDB/MinIO stay.
- **FR-ARC-06** Storage split (see [11-data-model.md](11-data-model.md)): Postgres = users/auth only; SurrealDB = documents, templates (parsed model + metadata), comments, suggestions, shares, sources, versions; MinIO = binaries (template docx files, exported artifacts, embedded images).
- **FR-ARC-07** Service→service calls are forbidden by default with **one sanctioned edge: service-document → service-render** (export/preview orchestration — document owns the data, assembles the render payload, tracks jobs; uses the shared client factory FR-ARC-15). The gateway stays a thin authenticating proxy with no domain logic. service-render remains stateless.

### Shared transport libraries (Go + Python)

The gRPC plumbing MUST NOT be re-implemented per service. It is an abstraction delivered as two shared libraries with mirrored responsibilities, so a new microservice in either language is bootstrapped in a few lines:

- **FR-ARC-15** **Go: `pkg/shared`** (extend the existing module) provides:
  - `grpc.Server` wrapper (exists: reflection, graceful stop) extended with: health service registration (`grpc.health.v1`), standard interceptor chain (logging — exists; recovery/panic-to-Internal; auth-metadata extraction; request-id propagation), keepalive/message-size defaults;
  - **client factory**: `grpcclient.Dial(cfg)` returning a connection with the mirrored client interceptor chain (request-id + user_id metadata propagation, timeouts, retry policy for idempotent RPCs), so gateway→backend dials are uniform;
  - error helpers: build/parse `google.golang.org/genproto/googleapis/rpc/errdetails` details ([10-api.md](10-api.md) FR-API-03);
  - config (`config.Load[T]`, exists) and slog setup (exists).
  All four Go services and the gateway consume ONLY this library for transport concerns; `service-files` migrates off connect-go onto it.
- **FR-ARC-16** **Python: `pkg/shared-py`** (new package, e.g. `reports_shared`, installed as a path dependency by service-render and service-ai) mirrors `pkg/shared` 1:1:
  - `serve(servicers, cfg)` bootstrap: `grpc.aio` server, health service, reflection, graceful shutdown on SIGINT/SIGTERM, keepalive/message-size defaults matching Go;
  - interceptor chain equivalent to Go's (structured JSON logging with request-id/user_id/rpc/latency/code, panic→`INTERNAL` recovery, auth-metadata extraction);
  - client factory for outbound gRPC calls with the same metadata propagation;
  - error helpers for the same `errdetails` payloads;
  - `BaseConfig` via `pydantic-settings` mirroring the Go `BaseConfig{GRPCPort}` shape + `.env` loading.
- **FR-ARC-17** Parity is a maintained contract: interceptor semantics, metadata keys (`x-request-id`, `x-user-id`), health/reflection availability, and error-detail encoding MUST be identical across the two libraries; a cross-language integration test (Go client ↔ Python server and vice versa) guards it in CI.

### Communication & conventions

- **FR-ARC-08** All services keep the established patterns via the shared libraries (FR-ARC-15/16): env config via struct tags (`caarlos0/env` style; Python via `pydantic-settings`), structured logging with a request logging interceptor, graceful shutdown.
- **FR-ARC-09** Errors cross service boundaries as gRPC status codes with machine-readable `errdetails` payloads (see [10-api.md](10-api.md) §Errors).
- **FR-ARC-10** CORS at the gateway allows the Angular dev origin (`http://localhost:4200`) — note: the current code allows `:3000` (React leftover) and MUST be corrected.

## Cleanup items (pre-work)

- **FR-ARC-11** Delete duplicate generated stubs at repo root (`auth/`, `document/`, `file/`, `template/`) and the stale nested tree `gen/go/github.com/...`; fix whatever buf/out path produced them; add the paths to `.gitignore` if the tool cannot be fixed.
- **FR-ARC-12** Remove unused Supabase scaffolding: `service-auth/internal/supabase/`, Supabase fields in the legacy `service-auth/internal/config/config.go` (consolidate on `pkg/shared/config.Load[T]`), `@supabase/supabase-js` from `client/package.json`, hardcoded Supabase keys in `client/src/environments/environment.ts`, `client/.env` OIDC entries.
- **FR-ARC-13** Decide sqlc vs hand-written repository in service-auth (currently both exist); keep one. Recommendation: keep sqlc since `sqlc.yaml` is already configured; port `internal/repository/user.go` queries into sqlc.
- **FR-ARC-14** `README.md` stub replaced with a real quickstart referencing `make` targets and this `requirements/` directory.
- **FR-ARC-18** Protocol migration pre-work: remove connect-go from `service-files` and `service-gateway` (rebuilt per FR-ARC-00/01), remove connect plugins from `buf.gen.yaml`, regenerate `gen/ts` as gRPC-web clients.

## Acceptance criteria

- A request from the Angular client to any implemented feature flows client →(gRPC-web)→ gateway →(gRPC)→ backend and back; no direct client→backend connections and no non-gRPC service surfaces remain.
- Cross-language parity test (FR-ARC-17) passes: Go↔Python calls exchange metadata, errors with details, and health checks identically.
- `docker compose up` + `make dev-*` brings up the full local stack including Ollama; `make k8s-deploy` deploys all six services.
- `buf generate` produces Go, TS, Python stubs with no stray output directories.
- Repo contains no Supabase references and no duplicate generated trees.

## Open questions

- Python package manager/tooling for the two services + `pkg/shared-py` (uv + ruff recommended) and how they hook into Nx targets.
- gRPC-web edge implementation: in-process Go wrapper (simpler local dev, one binary) vs Envoy sidecar/filter in k8s (battle-tested streaming support). Recommendation: in-process wrapper for MVP; the choice is invisible to clients and backends.
