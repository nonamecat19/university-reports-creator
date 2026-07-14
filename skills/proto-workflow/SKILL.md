---
name: proto-workflow
description: "Buf v2 protobuf workflow for this project. Use when creating/modifying .proto files, adding RPCs, generating code, linting protos, or working with gRPC service definitions. Covers the exact conventions, naming rules, and code generation pipeline used in this codebase."
---

# Proto/Buf Workflow

Protobuf development guide for this project. Buf v2 manages linting, breaking change detection, and code generation.

## Quick Commands

```bash
make proto          # Regenerate all code (Go + TypeScript)
make generate       # proto + go mod tidy in gen/go and pkg/shared
npx buf lint        # Lint proto files
npx buf format -w   # Auto-format proto files
```

## Project Layout

```
proto/
  auth/auth.proto
  document/document.proto
  template/template.proto
  file/file.proto
  ai/ai.proto
gen/
  go/     ← protoc-gen-go + protoc-gen-go-grpc output
  ts/     ← @protobuf-ts/plugin output
```

One package per service. Package names are flat: `auth`, `document`, `template`, `ai`, `file`.

## Buf Configuration

### buf.yaml

```yaml
version: v2
modules:
  - path: proto
    name: buf.build/nnc/university-reports-creator
lint:
  use: [STANDARD]
  except:
    - PACKAGE_VERSION_SUFFIX      # packages don't need v1 suffix
    - PACKAGE_DIRECTORY_MATCH     # dirs don't need to match package names
    - RPC_REQUEST_RESPONSE_UNIQUE # RPCs can reuse request/response types
    - RPC_RESPONSE_STANDARD_NAME  # non-standard response names allowed
breaking:
  use: [FILE]
```

### buf.gen.yaml

```yaml
version: v2
plugins:
  - local: protoc-gen-go
    out: gen/go
    opt: module=github.com/nnc/university-reports-creator/gen/go
  - local: protoc-gen-go-grpc
    out: gen/go
    opt: module=github.com/nnc/university-reports-creator/gen/go
  - local: ./node_modules/.bin/protoc-gen-ts
    out: gen/ts
```

## Naming Conventions

### Packages & Go Import Paths

| Proto package | Go package path |
|---|---|
| `auth` | `github.com/nnc/university-reports-creator/gen/go/auth` |
| `document` | `github.com/nnc/university-reports-creator/gen/go/document` |
| `template` | `github.com/nnc/university-reports-creator/gen/go/template` |
| `file` | `github.com/nnc/university-reports-creator/gen/go/file` |
| `ai` | `github.com/nnc/university-reports-creator/gen/go/ai` |

Every proto file must have:
```protobuf
syntax = "proto3";
package <name>;
option go_package = "github.com/nnc/university-reports-creator/gen/go/<name>";
```

### Enums (Buf STANDARD rules)

- Full prefix naming: `ROLE_OWNER`, `FINDING_SEVERITY_ERROR`
- Always start with `<PREFIX>_UNSPECIFIED = 0`
- Examples: `SectionKind`, `DocumentFilter`, `FindingSeverity`, `GrammarTier`

### RPCs & Messages

- RPC naming: `<Verb><Noun>` — e.g., `CreateDocument`, `GetProfile`, `CorrectGrammar`
- Request: `<Verb><Noun>Request` — Response: `<Verb><Noun>Response`
- RPCs may share response types (e.g., `DocumentResponse` used by Create, Get, Rename, Update)
- Empty responses: either custom `DeleteDocumentResponse {}` or `google.protobuf.Empty`

### Field Conventions

- Timestamps: `google.protobuf.Timestamp` from well-known types
- Pagination: `page_size`, `page_token`, `next_page_token`, `total_count`
- Binary data: `bytes` type (file upload/download)
- JSON stored as `string` (ProseMirror JSON, model JSON, CSL-JSON)
- Concurrency: `int32 revision` / `int32 metadata_revision` for optimistic locking
- Metadata: `map<string, string>` for flexible key-value pairs

## Streaming Patterns

Server-side streaming for AI operations:
```protobuf
rpc GenerateTextStream(GenerateTextRequest) returns (stream GenerateTextChunk);
rpc AnalyzeDocument(AnalyzeDocumentRequest) returns (stream AnalysisFinding);
rpc CorrectGrammar(CorrectGrammarRequest) returns (stream GrammarSuggestion);
rpc FindSources(FindSourcesRequest) returns (stream SourceSuggestion);
```

Streaming RPCs return individual chunks/findings directly — not wrapped in a response envelope.

## Code Generation Flow

1. Edit `.proto` files in `proto/`
2. Run `make proto` (or `npx buf generate`)
3. Go stubs generated to `gen/go/` (module `github.com/nnc/university-reports-creator/gen/go`)
4. TypeScript types generated to `gen/ts/`
5. Run `cd gen/go && go mod tidy` and `cd pkg/shared && go mod tidy`
6. Or just run `make generate` (does all of the above)

**Note:** `gen/` is likely `.gitignore`d — must be generated locally before building.

## Adding a New Service

1. Create `proto/<service>/<service>.proto`
2. Follow the syntax/package/go_package pattern above
3. Add to `buf.yaml` if needed (single module covers all protos)
4. Run `make proto`
5. Import the generated Go package in your service's `go.mod`
6. Register the service server in `cmd/server/main.go`

## Adding a New RPC to Existing Service

1. Add the `rpc`, `Request`, and `Response` messages to the `.proto` file
2. Run `make proto`
3. Implement the new method in the Go service (embed `pb.Unimplemented<Service>Server`)
4. The TypeScript client gets the new method automatically

## Comments Convention

Reference functional requirement IDs in proto comments:
```protobuf
// FR-EDT-09: Section content editing
rpc UpdateSection(UpdateSectionRequest) returns (SectionResponse);
```
