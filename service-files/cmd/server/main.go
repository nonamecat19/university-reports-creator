package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/nnc/university-reports-creator/gen/go/file"
	grpcserver "github.com/nnc/university-reports-creator/pkg/shared/grpc"
	"github.com/nnc/university-reports-creator/service-files/internal/config"
	"github.com/nnc/university-reports-creator/service-files/internal/service"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	fileService, err := service.New(
		cfg.Minio.Endpoint,
		cfg.Minio.AccessKey,
		cfg.Minio.SecretKey,
		cfg.Minio.Bucket,
		cfg.Minio.UseSSL,
	)
	if err != nil {
		slog.Error("failed to create file service", "error", err)
		os.Exit(1)
	}

	srv := grpcserver.New()
	file.RegisterFileServiceServer(srv.Server(), fileService)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Abandoned chunk-upload sessions expire on their own (FR-API-13); the
	// sweeper is what actually frees their buffers.
	go fileService.StartSessionSweeper(ctx)

	go srv.Run(cfg.GRPCPort)

	<-ctx.Done()
	slog.Info("shutting down service-files...")
}
