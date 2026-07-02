package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/improbable-eng/grpc-web/go/grpcweb"
	grpcproxy "github.com/mwitkow/grpc-proxy/proxy"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"

	"github.com/nnc/university-reports-creator/pkg/shared/jwtauth"
	"github.com/nnc/university-reports-creator/service-gateway/internal/config"
	"github.com/nnc/university-reports-creator/service-gateway/internal/proxy"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	pubKey, err := jwtauth.LoadPublicKeyFromFile(cfg.JWTPublicKeyPath)
	if err != nil {
		slog.Error("failed to load JWT public key", "error", err)
		os.Exit(1)
	}

	authConn, err := dialBackend(cfg.ServiceAuth)
	if err != nil {
		slog.Error("failed to dial service-auth", "error", err)
		os.Exit(1)
	}
	docConn, err := dialBackend(cfg.ServiceDocument)
	if err != nil {
		slog.Error("failed to dial service-document", "error", err)
		os.Exit(1)
	}
	filesConn, err := dialBackend(cfg.ServiceFiles)
	if err != nil {
		slog.Error("failed to dial service-files", "error", err)
		os.Exit(1)
	}
	aiConn, err := dialBackend(cfg.ServiceAI)
	if err != nil {
		slog.Error("failed to dial service-ai", "error", err)
		os.Exit(1)
	}

	backends := proxy.Backends{Auth: authConn, Document: docConn, Files: filesConn, AI: aiConn}
	director := proxy.NewDirector(backends, pubKey)

	grpcServer := grpc.NewServer(
		grpc.CustomCodec(grpcproxy.Codec()), //nolint:staticcheck // required by the transparent proxy pattern
		grpc.UnknownServiceHandler(grpcproxy.TransparentHandler(director)),
		proxy.StreamLogging(),
	)

	wrapped := grpcweb.WrapServer(
		grpcServer,
		grpcweb.WithOriginFunc(func(origin string) bool { return origin == cfg.ClientOrigin }),
		grpcweb.WithCorsForRegisteredEndpointsOnly(false), // we only have proxied, unregistered endpoints
	)

	srv := &http.Server{
		Addr:    cfg.HTTPPort,
		Handler: wrapped,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("gateway started", "addr", cfg.HTTPPort, "client_origin", cfg.ClientOrigin)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("gateway server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down gateway...")
	_ = srv.Shutdown(context.Background())
}

// dialBackend opens a client connection using the proxy's raw codec: the
// gateway forwards bytes without decoding them into typed messages. Active
// keepalive pings are required here: this connection sits idle between
// browser interactions (unlike a tight request loop), and without them a
// silently-dropped connection is only discovered when a real RPC hits it,
// surfacing as a spurious RST_STREAM/INTERNAL error on the next call.
func dialBackend(addr string) (*grpc.ClientConn, error) {
	return grpc.NewClient(addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithCodec(grpcproxy.Codec()), //nolint:staticcheck // required by the transparent proxy pattern
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			// Must stay above the backends' EnforcementPolicy.MinTime (30s,
			// pkg/shared/grpc.New) or the server tears down the connection
			// with GOAWAY("too_many_pings") instead of keeping it healthy.
			Time:                35 * time.Second,
			Timeout:             10 * time.Second,
			PermitWithoutStream: true,
		}),
	)
}
