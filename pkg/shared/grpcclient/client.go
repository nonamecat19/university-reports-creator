// Package grpcclient is the mirrored client-side half of pkg/shared/grpc
// (FR-ARC-15): a dial factory with the standard client interceptor chain so
// gateway->backend and service->service dials are uniform.
package grpcclient

import (
	"context"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/metadata"

	grpcserver "github.com/nnc/university-reports-creator/pkg/shared/grpc"
	"github.com/nnc/university-reports-creator/pkg/shared/grpcmeta"
)

// Dial opens a client connection to target with metadata propagation
// (x-request-id, x-user-id), matching message-size/keepalive defaults, and
// insecure transport credentials (internal cluster traffic).
func Dial(target string, opts ...grpc.DialOption) (*grpc.ClientConn, error) {
	defaults := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithChainUnaryInterceptor(unaryMetadataPropagation()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(grpcserver.MaxMessageSize),
			grpc.MaxCallSendMsgSize(grpcserver.MaxMessageSize),
		),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                2 * time.Minute,
			Timeout:             20 * time.Second,
			PermitWithoutStream: true,
		}),
	}
	return grpc.NewClient(target, append(defaults, opts...)...)
}

// unaryMetadataPropagation forwards x-request-id/x-user-id from the caller's
// context onto outgoing metadata, so parity holds across service hops.
func unaryMetadataPropagation() grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		if id := grpcmeta.RequestID(ctx); id != "" {
			ctx = metadata.AppendToOutgoingContext(ctx, grpcmeta.RequestIDKey, id)
		}
		if uid := grpcmeta.UserID(ctx); uid != "" {
			ctx = metadata.AppendToOutgoingContext(ctx, grpcmeta.UserIDKey, uid)
		}
		return invoker(ctx, method, req, reply, cc, opts...)
	}
}
