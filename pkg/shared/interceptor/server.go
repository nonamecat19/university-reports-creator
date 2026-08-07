package interceptor

import (
	"context"
	"log/slog"
	"runtime/debug"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/nnc/university-reports-creator/pkg/shared/grpcmeta"
)

// UnaryServerChain is the standard server interceptor chain (FR-ARC-15):
// request-id + user-id extraction, structured logging, panic recovery.
func UnaryServerChain() grpc.ServerOption {
	return grpc.ChainUnaryInterceptor(
		unaryContext(),
		unaryLogging(),
		unaryRecovery(),
	)
}

// unaryContext populates the request context with x-request-id (generated when
// absent) and x-user-id from incoming metadata.
func unaryContext() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		ctx = grpcmeta.WithRequestID(ctx, grpcmeta.EnsureRequestID(ctx))
		if userID := grpcmeta.FromIncoming(ctx, grpcmeta.UserIDKey); userID != "" {
			ctx = grpcmeta.WithUserID(ctx, userID)
		}
		if userName := grpcmeta.FromIncoming(ctx, grpcmeta.UserNameKey); userName != "" {
			ctx = grpcmeta.WithUserName(ctx, userName)
		}
		return handler(ctx, req)
	}
}

func unaryLogging() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		start := time.Now()
		resp, err := handler(ctx, req)

		attrs := []any{
			"method", info.FullMethod,
			"duration", time.Since(start),
			"code", status.Code(err).String(),
			"request_id", grpcmeta.RequestID(ctx),
		}
		if userID := grpcmeta.UserID(ctx); userID != "" {
			attrs = append(attrs, "user_id", userID)
		}
		if err != nil {
			attrs = append(attrs, "error", err)
		}
		slog.InfoContext(ctx, "gRPC call", attrs...)

		return resp, err
	}
}

func unaryRecovery() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (resp any, err error) {
		defer func() {
			if r := recover(); r != nil {
				slog.ErrorContext(ctx, "panic in handler",
					"method", info.FullMethod,
					"panic", r,
					"stack", string(debug.Stack()),
				)
				err = status.Error(codes.Internal, "internal error")
			}
		}()
		return handler(ctx, req)
	}
}
