package grpcserver

import (
	"context"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"

	"github.com/nnc/university-reports-creator/pkg/shared/interceptor"
)

const MaxMessageSize = 16 * 1024 * 1024

type ServiceRegistrar func(srv *grpc.Server)

type Server struct {
	srv    *grpc.Server
	health *health.Server
	port   string
}

// New builds a gRPC server with the standard interceptor chain, health service,
// reflection, and keepalive/message-size defaults (FR-ARC-15). Extra options are
// appended after the defaults.
func New(opts ...grpc.ServerOption) *Server {
	defaults := []grpc.ServerOption{
		interceptor.UnaryServerChain(),
		grpc.MaxRecvMsgSize(MaxMessageSize),
		grpc.MaxSendMsgSize(MaxMessageSize),
		grpc.KeepaliveParams(keepalive.ServerParameters{
			Time:    2 * time.Minute,
			Timeout: 20 * time.Second,
		}),
		grpc.KeepaliveEnforcementPolicy(keepalive.EnforcementPolicy{
			MinTime:             30 * time.Second,
			PermitWithoutStream: true,
		}),
	}
	srv := &Server{
		srv:    grpc.NewServer(append(defaults, opts...)...),
		health: health.NewServer(),
	}
	healthpb.RegisterHealthServer(srv.srv, srv.health)
	reflection.Register(srv.srv)
	return srv
}

func (s *Server) Server() *grpc.Server {
	return s.srv
}

func (s *Server) Register(registrar ServiceRegistrar) {
	registrar(s.srv)
}

// SetServing flips the overall health status reported by grpc.health.v1.
func (s *Server) SetServing(serving bool) {
	st := healthpb.HealthCheckResponse_SERVING
	if !serving {
		st = healthpb.HealthCheckResponse_NOT_SERVING
	}
	s.health.SetServingStatus("", st)
}

// Run listens on port and blocks until SIGINT/SIGTERM, then stops gracefully.
func (s *Server) Run(port string) {
	s.port = port
	lis, err := net.Listen("tcp", port)
	if err != nil {
		slog.Error("failed to listen", "error", err, "port", port)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	s.SetServing(true)

	go func() {
		slog.Info("gRPC server started", "port", port)
		if err := s.srv.Serve(lis); err != nil {
			slog.Error("gRPC server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down gRPC server...", "port", s.port)
	s.SetServing(false)
	s.srv.GracefulStop()
}
