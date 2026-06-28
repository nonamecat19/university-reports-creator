// Package proxy builds the gRPC-web -> gRPC edge (FR-ARC-01): a StreamDirector
// that authenticates each call (FR-AUTH-13, FR-ARC-02), routes it to the right
// backend by service name, and forwards it transparently without decoding the
// message (the gateway never needs to know the payload shape).
package proxy

import (
	"context"
	"crypto/rsa"
	"strings"

	"github.com/google/uuid"
	"github.com/mwitkow/grpc-proxy/proxy"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/nnc/university-reports-creator/pkg/shared/grpcmeta"
	"github.com/nnc/university-reports-creator/pkg/shared/jwtauth"
)

// exemptMethods are the only RPCs reachable without a valid access token
// (FR-ARC-02): registration/login/refresh. Everything else requires auth.
var exemptMethods = map[string]bool{
	"/auth.AuthService/Register":        true,
	"/auth.AuthService/Login":           true,
	"/auth.AuthService/LoginWithGoogle": true,
	"/auth.AuthService/RefreshToken":    true,
}

// Backends maps proto package name (the segment before the first '.' after
// the leading '/') to the backend connection that serves it.
type Backends struct {
	Auth     *grpc.ClientConn // auth.AuthService
	Document *grpc.ClientConn // document.DocumentService, template.TemplateService
	Files    *grpc.ClientConn // file.FileService
}

func (b Backends) forMethod(fullMethod string) (*grpc.ClientConn, error) {
	pkg, _, ok := splitMethod(fullMethod)
	if !ok {
		return nil, status.Errorf(codes.Unimplemented, "malformed method %q", fullMethod)
	}
	switch pkg {
	case "auth":
		return b.Auth, nil
	case "document", "template":
		return b.Document, nil
	case "file":
		return b.Files, nil
	default:
		return nil, status.Errorf(codes.Unimplemented, "unknown service package %q", pkg)
	}
}

// splitMethod parses "/pkg.Service/Method" into ("pkg", "Service/Method", true).
func splitMethod(fullMethod string) (pkgName, rest string, ok bool) {
	trimmed := strings.TrimPrefix(fullMethod, "/")
	serviceAndMethod := strings.SplitN(trimmed, "/", 2)
	if len(serviceAndMethod) != 2 {
		return "", "", false
	}
	dot := strings.Index(serviceAndMethod[0], ".")
	if dot < 0 {
		return "", "", false
	}
	return serviceAndMethod[0][:dot], serviceAndMethod[1], true
}

// NewDirector builds the StreamDirector used as the gateway's
// grpc.UnknownServiceHandler (FR-ARC-01/02, FR-AUTH-13).
func NewDirector(backends Backends, publicKey *rsa.PublicKey) proxy.StreamDirector {
	return func(ctx context.Context, fullMethod string) (context.Context, grpc.ClientConnInterface, error) {
		conn, err := backends.forMethod(fullMethod)
		if err != nil {
			return ctx, nil, err
		}

		// Built from scratch rather than copying incoming metadata wholesale:
		// the grpc-web translation surfaces the browser's raw HTTP headers as
		// gRPC metadata, including hop-by-hop ones like "connection" (always
		// sent by fetch/XHR as "keep-alive"). Forwarding those over the real
		// HTTP/2 connection to the backend violates RFC 7540 §8.1.2.2 and the
		// backend's HTTP/2 stack resets the stream with PROTOCOL_ERROR.
		incoming, _ := metadata.FromIncomingContext(ctx)
		outgoing := metadata.MD{}

		requestID := firstValue(incoming, grpcmeta.RequestIDKey)
		if requestID == "" {
			requestID = uuid.NewString()
		}
		outgoing.Set(grpcmeta.RequestIDKey, requestID)

		if !exemptMethods[fullMethod] {
			token, err := bearerToken(incoming)
			if err != nil {
				return ctx, nil, err
			}
			claims, err := jwtauth.Verify(publicKey, token)
			if err != nil {
				return ctx, nil, status.Error(codes.Unauthenticated, "invalid or expired access token")
			}
			outgoing.Set(grpcmeta.UserIDKey, claims.Subject)
		}

		return metadata.NewOutgoingContext(ctx, outgoing), conn, nil
	}
}

func firstValue(md metadata.MD, key string) string {
	if vals := md.Get(key); len(vals) > 0 {
		return vals[0]
	}
	return ""
}

func bearerToken(md metadata.MD) (string, error) {
	auth := firstValue(md, "authorization")
	if auth == "" {
		return "", status.Error(codes.Unauthenticated, "missing authorization header")
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(auth, prefix) {
		return "", status.Error(codes.Unauthenticated, "authorization header must be a Bearer token")
	}
	return strings.TrimPrefix(auth, prefix), nil
}
