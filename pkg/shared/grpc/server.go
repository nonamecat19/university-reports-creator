package grpcserver

import (
	"context"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	"github.com/nnc/university-reports-creator/pkg/shared/interceptor"
)

type ServiceRegistrar func(srv *grpc.Server)

type Server struct {
	srv  *grpc.Server
	port string
}

func New(opts ...grpc.ServerOption) *Server {
	if len(opts) == 0 {
		opts = append(opts, interceptor.UnaryLoggingOption())
	}
	srv := &Server{
		srv: grpc.NewServer(opts...),
	}
	srv.EnableReflection()
	return srv
}

func (s *Server) Server() *grpc.Server {
	return s.srv
}

func (s *Server) Register(registrar ServiceRegistrar) {
	registrar(s.srv)
}

func (s *Server) EnableReflection() {
	reflection.Register(s.srv)
}

func (s *Server) Run(port string) {
	s.port = port
	lis, err := net.Listen("tcp", port)
	if err != nil {
		slog.Error("failed to listen", "error", err, "port", port)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("gRPC server started", "port", port)
		if err := s.srv.Serve(lis); err != nil {
			slog.Error("gRPC server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down gRPC server...", "port", s.port)
	s.srv.GracefulStop()
}
