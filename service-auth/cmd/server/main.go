package main

import (
	"context"
	"database/sql"
	"embed"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"

	_ "github.com/lib/pq"
	"github.com/pressly/goose/v3"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	pb "github.com/nnc/university-reports-creator/service-auth/gen/auth"
	"github.com/nnc/university-reports-creator/service-auth/internal/config"
	"github.com/nnc/university-reports-creator/service-auth/internal/interceptor"
	"github.com/nnc/university-reports-creator/service-auth/internal/repository"
	"github.com/nnc/university-reports-creator/service-auth/internal/service"
	"github.com/nnc/university-reports-creator/service-auth/internal/token"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	conn, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer conn.Close()

	if err := conn.Ping(); err != nil {
		slog.Error("failed to ping database", "error", err)
		os.Exit(1)
	}

	goose.SetBaseFS(migrationsFS)
	if err := goose.UpContext(context.Background(), conn, "migrations"); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	repo := repository.NewUserRepository(conn)
	tokenManager := token.NewJWTManager(cfg.JWTSecret, cfg.AccessTokenDuration, cfg.RefreshTokenDuration)
	authService := service.NewAuthService(repo, tokenManager)

	srv := grpc.NewServer(
		grpc.UnaryInterceptor(interceptor.UnaryLogging()),
	)
	pb.RegisterAuthServiceServer(srv, authService)
	reflection.Register(srv)

	lis, err := net.Listen("tcp", cfg.GRPCPort)
	if err != nil {
		slog.Error("failed to listen", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("gRPC server starting", "port", cfg.GRPCPort)
		if err := srv.Serve(lis); err != nil {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down server...")
	srv.GracefulStop()
	slog.Info("server stopped")
}
