package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/nnc/university-reports-creator/gen/go/file/fileconnect"
	"github.com/nnc/university-reports-creator/service-files/internal/config"
	"github.com/nnc/university-reports-creator/service-files/internal/service"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	fileService, err := service.New(
		cfg.Minio.Endpoint,
		cfg.Minio.AccessKey,
		cfg.Minio.SecretKey,
		cfg.Minio.Bucket,
		cfg.Minio.UseSSL,
	)
	if err != nil {
		log.Fatalf("failed to create file service: %v", err)
	}

	path, handler := fileconnect.NewFileServiceHandler(fileService)
	mux := http.NewServeMux()
	mux.Handle(path, handler)

	addr := cfg.GRPCPort
	srv := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("server started", "addr", addr, "handler", path)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down server...")
	if err := srv.Shutdown(context.Background()); err != nil {
		slog.Error("shutdown error", "error", err)
	}
}
