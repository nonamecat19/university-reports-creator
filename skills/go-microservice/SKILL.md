---
name: go-microservice
description: "Go microservice patterns for this project. Use when creating or modifying Go backend services, implementing gRPC handlers, writing repositories, adding interceptors, or working with the shared library. Covers the exact architecture, DI patterns, error handling, and conventions used across all 4 services."
---

# Go Microservice Patterns

Architecture and coding patterns for the Go backend services. Follow these exactly when adding or modifying code.

## Service Layout

```
service-<name>/
  cmd/server/main.go        # Entry point
  internal/
    config/                  # Service-specific config struct
    db/                      # Database client setup (sqlc, surrealdb, minio)
    model/                   # Domain models (plain Go structs)
    repository/              # Data access layer
    service/                 # gRPC handler implementations
    interceptor/             # Service-specific interceptors (if any)
```

Shared code lives in `pkg/shared/` (see Shared Library section below).

## main.go Bootstrap Sequence

Every service follows this exact order:

```go
func main() {
    // 1. Load config
    cfg, err := config.Load[ServiceConfig]()

    // 2. Initialize infrastructure (DB, MinIO, etc.)
    conn, err := sql.Open("postgres", cfg.DatabaseURL)

    // 3. Create repositories
    userRepo := repository.NewUserRepository(conn)

    // 4. Create services, inject dependencies
    authService := service.NewAuthService(userRepo, refreshRepo, tokenManager)

    // 5. Create gRPC server (uses shared grpcserver.New())
    srv := grpcserver.New()

    // 6. Register protobuf service server
    auth.RegisterAuthServiceServer(srv.Server(), authService)

    // 7. Run with signal handling
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()
    go srv.Run(cfg.GRPCPort)
    <-ctx.Done()
}
```

## Config Loading

```go
type ServiceConfig struct {
    config.BaseConfig   // embeds GRPCPort with default ":50051"
    DatabaseURL string `env:"DATABASE_URL"`
    // ... service-specific fields with env tags
}

cfg, err := config.Load[ServiceConfig]()
```

Uses `caarlos0/env` struct tags. `godotenv.Load()` is called automatically (best-effort).

## gRPC Service Implementation

### Struct Pattern

```go
type AuthService struct {
    pb.UnimplementedAuthServiceServer   // always embed for forward compat
    repo        repository.UserRepository
    tokens      *token.JWTManager
    // ... injected dependencies
}

func NewAuthService(repo repository.UserRepository, tokens *token.JWTManager) *AuthService {
    return &AuthService{repo: repo, tokens: tokens}
}
```

### Method Pattern

```go
func (s *AuthService) Register(ctx context.Context, req *pb.RegisterRequest) (*pb.RegisterResponse, error) {
    // Validate input
    if !emailRE.MatchString(req.GetEmail()) {
        return nil, status.Error(codes.InvalidArgument, "invalid email format")
    }

    // Call repository
    user, err := s.repo.Create(ctx, &model.User{...})
    if err != nil {
        return nil, err  // repository already wraps errors as gRPC status
    }

    // Return proto response
    return &pb.RegisterResponse{UserId: user.ID}, nil
}
```

### Authenticated Calls

```go
func (s *AuthService) GetProfile(ctx context.Context, _ *pb.GetProfileRequest) (*pb.ProfileResponse, error) {
    userID := grpcmeta.UserID(ctx)
    if userID == "" {
        return nil, status.Error(codes.Unauthenticated, "authentication required")
    }
    // ...
}
```

The gateway injects `x-user-id` into metadata after JWT verification. The shared interceptor extracts it into typed context values.

It also injects `x-user-name` — the caller's display name from the same verified token, falling back to the email. Services must **not** call service-auth to resolve a user id (FR-ARC-07), so any record that later has to show a human author (comments, suggestions, shares) copies `grpcmeta.UserName(ctx)` into an `author_name`/`user_name` column at write time. Names are for display only; authorization always uses the id.

## Error Handling

Use `google.golang.org/grpc/status` with standard codes:

| Situation | Code | Pattern |
|---|---|---|
| Missing/not found | `codes.NotFound` | `status.Errorf(codes.NotFound, "user %q not found", id)` |
| Bad input | `codes.InvalidArgument` | `status.Error(codes.InvalidArgument, "email required")` |
| Auth failure | `codes.Unauthenticated` | `status.Error(codes.Unauthenticated, "authentication required")` |
| Constraint violation | `codes.AlreadyExists` | `status.Errorf(codes.AlreadyExists, "email already registered")` |
| Optimistic concurrency | `codes.FailedPrecondition` | `grpcerr.StaleRevision("document modified", currentRev)` |
| Unexpected error | `codes.Internal` | `status.Errorf(codes.Internal, "failed to query: %v", err)` |
| Not implemented | `codes.Unimplemented` | `status.Errorf(codes.Unimplemented, "unknown package %q", pkg)` |

### Structured Error Details

```go
// Field validation errors
return nil, grpcerr.InvalidArgument("invalid input",
    grpcerr.FieldViolation("email", "must be valid email"),
)

// Optimistic concurrency (StaleRevision)
return nil, grpcerr.StaleRevision("document was modified", currentRevision)
// Client can parse: grpcerr.CurrentRevision(err)
```

## Repository Patterns

### PostgreSQL (service-auth)

Interface + private struct wrapping sqlc `Queries`:

```go
type UserRepository interface {
    Create(ctx context.Context, user *model.User) error
    FindByEmail(ctx context.Context, email string) (*model.User, error)
}

type userRepo struct {
    q *db.Queries  // sqlc-generated
}

func NewUserRepository(conn *sql.DB) UserRepository {
    return &userRepo{q: db.New(conn)}
}
```

Error mapping: `sql.ErrNoRows` → `codes.NotFound`, unique violations → `codes.AlreadyExists`.

Nullable fields: `sql.NullString` → plain Go string at the repository boundary.

### SurrealDB (service-document)

Concrete structs (no interfaces) using `surrealdb.Query[T]` with typed generics:

```go
func (r *DocumentRepository) Create(ctx context.Context, ownerID, title string) (*Document, error) {
    const q = `CREATE type::record($table, $id) CONTENT {
        owner_id: $owner_id, title: $title, ...
    }`
    res, err := surrealdb.Query[[]Document](ctx, r.db, q, map[string]any{
        "table": documentTable, "id": uuid.New().String(),
        "owner_id": ownerID, "title": title,
    })
    doc, err := single(res)
    return doc, nil
}
```

Key patterns:
- `single(res)` — unwraps first row, hydrates ID
- `rows(res)` — multi-row results
- `countFrom(res)` — `SELECT count() ... GROUP ALL`
- `ErrStaleRevision` sentinel for optimistic concurrency
- Schema runs on startup with idempotent `DEFINE TABLE IF NOT EXISTS`

### MinIO (service-files)

No repository layer — service wraps MinIO client directly:

```go
type FileService struct {
    pb.UnimplementedFileServiceServer
    minio  *minio.Client
    bucket string
}
```

## Service-Document Specific Patterns

### Aggregate Factories

```go
// repository/repos.go
type Repos struct {
    Document *DocumentRepository
    Section  *SectionRepository
    Template *TemplateRepository
}
func New(db *surrealdb.DB) *Repos { ... }

// service/services.go
type Services struct {
    Document *DocumentService
    Template *TemplateService
}
func New(repos *repository.Repos) *Services {
    // Creates services, calls Init() for DI
}
```

### Base Struct for Cross-Service Access

```go
type Base struct {
    Repos    *repository.Repos
    Services *Services
}

type DocumentService struct {
    pb.UnimplementedDocumentServiceServer
    Base  // embeds Repos + Services
}
```

Services can reference each other via `s.Services.Template`.

## Shared Library (`pkg/shared/`)

| Package | Purpose |
|---|---|
| `config` | `config.Load[T]()` generic env config loader |
| `grpc` (grpcserver) | `grpcserver.New()` — standard server with interceptors, health, reflection, keepalive |
| `interceptor` | `UnaryServerChain()` — context extraction → logging → recovery |
| `grpcmeta` | `WithUserID(ctx)`, `UserID(ctx)`, `UserName(ctx)`, `RequestID(ctx)` — typed context values |
| `grpcerr` | `InvalidArgument()`, `StaleRevision()`, `CurrentRevision()` — structured errors |
| `jwtauth` | `Sign()`, `Verify()`, `LoadPrivateKeyFromFile()`, `LoadPublicKeyFromFile()` |
| `grpcclient` | `Dial()` — client with metadata propagation interceptor |

### Interceptor Chain Order

1. `unaryContext()` — extracts `x-request-id` + `x-user-id` + `x-user-name` from metadata into context
2. `unaryLogging()` — structured slog with method/duration/code/request_id/user_id
3. `unaryRecovery()` — panic → `codes.Internal`, full stack trace to slog

## Gateway Pattern (service-gateway)

The gateway is **different** from other services — it's a transparent proxy, not a service implementation:

- Does NOT use `grpcserver.New()`
- Uses `grpcproxy.Codec()` + `grpcproxy.TransparentHandler(director)`
- Routes by proto package name (segment before first `.` in method)
- Exempts auth endpoints (Register, Login, LoginWithGoogle, RefreshToken)
- Injects `x-user-id` and `x-user-name` for all other endpoints
- Uses `grpcweb.WrapServer` for browser gRPC-web translation

## Go Workspace

```
go.work (go 1.25.6)
  use: service-auth, service-document, service-files, service-gateway
  replace: gen/go => ./gen/go
           pkg/shared => ./pkg/shared
```

Each service's `go.mod` mirrors with local `replace` directives. Run `go work sync` after adding new workspace members.
