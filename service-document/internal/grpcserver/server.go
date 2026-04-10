package grpcserver

import (
	"fmt"
	"log/slog"
	"net"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	"github.com/nnc/university-reports-creator/service-document/internal/interceptor"
)

type RegisterFunc func(s *grpc.Server)

func New(registerFuncs ...RegisterFunc) *grpc.Server {
	srv := grpc.NewServer(
		grpc.UnaryInterceptor(interceptor.UnaryLogging()),
	)

	for _, register := range registerFuncs {
		register(srv)
	}

	reflection.Register(srv)

	return srv
}

func Run(srv *grpc.Server, port string) error {
	lis, err := net.Listen("tcp", port)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", port, err)
	}

	slog.Info("starting gRPC server", "port", port)

	return srv.Serve(lis)
}
