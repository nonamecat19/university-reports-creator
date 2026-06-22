# 02 — Authentication & User Accounts

## Purpose

Unify the currently split auth (Supabase JS in the client vs. custom JWT in `service-auth`) on the **custom JWT backend**. The client authenticates exclusively against `service-auth` through the gateway; Supabase is removed entirely.

## Current state

- `service-auth` already implements: `Register` (bcrypt), `Login`, `LoginWithGoogle` (verifies a Google ID token via `oauth2.googleapis.com/tokeninfo`, then issues own JWTs), `ValidateToken`, `RefreshToken` (`proto/auth/auth.proto`, `service-auth/internal/service/auth.go`, `internal/token/jwt.go`).
- Postgres `users` table exists (`sql/schema/001_users.sql`): id, email, name, hashed_password, created_at; goose migrations embedded in the binary.
- Angular client uses `@supabase/supabase-js` (`signInWithPassword`, `signInWithOAuth`) — to be removed. `client/src/app/core/interceptors/token.interceptor.ts` exists but is not registered.
- `authGuard` on the main layout route is commented out in `client/src/app.routes.ts`.

## Functional requirements

### Tokens

- **FR-AUTH-01** Access token: JWT, 15 min TTL, claims: `sub` (user id), `email`, `iat`, `exp`, `jti`. Refresh token: opaque or JWT, 30 days TTL, stored server-side (Postgres `refresh_tokens` table: id, user_id, token_hash, expires_at, revoked_at) so refresh tokens can be revoked and rotated.
- **FR-AUTH-02** `RefreshToken` MUST rotate: a used refresh token is revoked and a new pair is issued. Reuse of a revoked token revokes the whole token family (defense against theft).
- **FR-AUTH-03** Token signing: RS256 (asymmetric) so the gateway and other services can validate access tokens with the public key **without calling service-auth** per request. service-auth exposes the public key (JWKS-style endpoint or env-distributed PEM). Migration from the current HMAC implementation is required.

### Flows

- **FR-AUTH-04** Email/password register + login (existing RPCs) — add server-side validation: email format, password ≥ 8 chars. Duplicate email → `CodeAlreadyExists`.
- **FR-AUTH-05** Google sign-in: client obtains a Google ID token via Google Identity Services (GIS) in the browser, sends it to `LoginWithGoogle`; backend verifies audience/expiry (existing logic), auto-creates the user on first login.
- **FR-AUTH-06** Logout: client discards tokens AND calls a new `Logout` RPC that revokes the refresh token.
- **FR-AUTH-07** Password reset and email verification: **out of MVP scope**, but the proto and users table reserve fields (`email_verified bool`). Documented as P-later in [13-roadmap.md](13-roadmap.md).
- **FR-AUTH-08** New `GetProfile` / `UpdateProfile` RPCs: name, and report-prefill defaults (university name, faculty, department, group, supervisor) used to prefill template metadata fields (see [03-templates.md](03-templates.md)).

### Client

- **FR-AUTH-09** Remove Supabase: dependency, env keys, `auth/callback` OAuth-callback route logic (replaced by GIS popup flow), Supabase calls in `AuthService`. `AuthService` keeps its Signals-based API (`currentUser`, `isAuthenticated` computed) but backs it with gateway RPCs via generated `gen/ts` gRPC-web clients.
- **FR-AUTH-10** Register the existing `token.interceptor.ts` in `app.config.ts` (`withInterceptors`): attach `Authorization: Bearer <access>`, on 401/`CodeUnauthenticated` attempt one silent refresh then redirect to `/auth/login`.
- **FR-AUTH-11** Re-enable `authGuard` on the layout shell route; keep `guestGuard` on `/auth/*`.
- **FR-AUTH-12** Token storage: access token in memory (Signal), refresh token in `localStorage`. Acceptable for this project's threat model; revisit httpOnly-cookie flow if the gateway later serves the SPA.

### Gateway middleware

- **FR-AUTH-13** Gateway auth interceptor (see FR-ARC-02): parse+validate JWT signature/expiry, put `user_id` into request headers/metadata for backends. Backends trust this metadata **only** from the gateway (network policy / shared secret header in k8s).

## Acceptance criteria

- Full flow works E2E: register → login → authorized RPC through gateway → token expiry → silent refresh → logout (refresh revoked, silent refresh fails).
- Google sign-in creates a user and issues internal JWTs; no Supabase code or config remains in the repo.
- Unauthenticated access to a protected route redirects to `/auth/login`; unauthenticated RPC returns `CodeUnauthenticated`.

## Open questions

- Single active refresh session per user vs. multiple devices (recommendation: multiple rows in `refresh_tokens`, no device limit for MVP).
