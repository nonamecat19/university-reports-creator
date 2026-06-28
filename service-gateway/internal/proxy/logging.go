package proxy

import (
	"log/slog"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/nnc/university-reports-creator/pkg/shared/grpcmeta"
)

// StreamLogging logs method/latency/code/request_id for every proxied call
// (FR-API-14). The interceptor sees the client's incoming metadata, not the
// director's enriched outgoing metadata, so user_id isn't available here —
// it's logged on the backend side instead, where the director's injected
// x-user-id lands in the request's incoming metadata.
func StreamLogging() grpc.ServerOption {
	return grpc.ChainStreamInterceptor(func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		start := time.Now()
		err := handler(srv, ss)

		md, _ := metadata.FromIncomingContext(ss.Context())
		attrs := []any{
			"method", info.FullMethod,
			"duration", time.Since(start),
			"code", status.Code(err).String(),
		}
		if requestID := firstValue(md, grpcmeta.RequestIDKey); requestID != "" {
			attrs = append(attrs, "request_id", requestID)
		}
		if err != nil {
			attrs = append(attrs, "error", err)
		}
		slog.Info("gateway proxied call", attrs...)
		return err
	})
}
