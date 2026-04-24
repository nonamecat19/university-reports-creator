package main

import (
	"context"
	"log"
	"log/slog"
	"os/signal"
	"syscall"

	"github.com/nnc/university-reports-creator/gen/go/document"
	"github.com/nnc/university-reports-creator/gen/go/template"
	grpcserver "github.com/nnc/university-reports-creator/pkg/shared/grpc"
	"github.com/nnc/university-reports-creator/service-document/internal/config"
	"github.com/nnc/university-reports-creator/service-document/internal/db"
	"github.com/nnc/university-reports-creator/service-document/internal/repository"
	"github.com/nnc/university-reports-creator/service-document/internal/service"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	ctx := context.Background()

	surrealDB, err := db.Connect(ctx, cfg.SurrealDB)
	if err != nil {
		log.Fatalf("failed to init database: %v", err)
	}
	defer surrealDB.Close(ctx)

	repos := repository.New(surrealDB)
	svcs := service.New(repos)

	srv := grpcserver.New()
	document.RegisterDocumentServiceServer(srv.Server(), svcs.Document)
	template.RegisterTemplateServiceServer(srv.Server(), svcs.Template)

	slog.Info("running in local mode - service discovery via env vars")

	runCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go srv.Run(cfg.GRPCPort)

	<-runCtx.Done()
	slog.Info("shutting down service-document...")
}
