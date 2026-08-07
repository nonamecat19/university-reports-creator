// Package grpcmeta defines the cross-service metadata contract (FR-ARC-15/17):
// metadata keys and context helpers for request id and authenticated user id.
package grpcmeta

import (
	"context"

	"github.com/google/uuid"
	"google.golang.org/grpc/metadata"
)

const (
	RequestIDKey = "x-request-id"
	UserIDKey    = "x-user-id"
	// UserNameKey carries the caller's display name, taken from the verified
	// access token by the gateway. It exists so a service can attribute a
	// write to a human-readable author without calling service-auth
	// (FR-ARC-07); it is never an authorization input.
	UserNameKey = "x-user-name"
)

type ctxKey string

const (
	ctxRequestID ctxKey = "request_id"
	ctxUserID    ctxKey = "user_id"
	ctxUserName  ctxKey = "user_name"
)

func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxRequestID, id)
}

func RequestID(ctx context.Context) string {
	v, _ := ctx.Value(ctxRequestID).(string)
	return v
}

func WithUserID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxUserID, id)
}

// UserID returns the authenticated user id injected by the gateway (FR-AUTH-13),
// or "" for unauthenticated calls.
func UserID(ctx context.Context) string {
	v, _ := ctx.Value(ctxUserID).(string)
	return v
}

func WithUserName(ctx context.Context, name string) context.Context {
	return context.WithValue(ctx, ctxUserName, name)
}

// UserName returns the caller's display name as forwarded by the gateway, or
// "" when the token carried none (older tokens, or an unauthenticated call).
func UserName(ctx context.Context) string {
	v, _ := ctx.Value(ctxUserName).(string)
	return v
}

// FromIncoming extracts the first metadata value for key from the incoming context.
func FromIncoming(ctx context.Context, key string) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	if vals := md.Get(key); len(vals) > 0 {
		return vals[0]
	}
	return ""
}

// EnsureRequestID returns the incoming request id or generates a new one.
func EnsureRequestID(ctx context.Context) string {
	if id := FromIncoming(ctx, RequestIDKey); id != "" {
		return id
	}
	return uuid.NewString()
}
