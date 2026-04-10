package main

import (
	"context"
	"log"

	"google.golang.org/grpc"

	pbDocument "github.com/nnc/university-reports-creator/service-document/gen/document"
	pbTemplate "github.com/nnc/university-reports-creator/service-document/gen/template"
	"github.com/nnc/university-reports-creator/service-document/internal/config"
	"github.com/nnc/university-reports-creator/service-document/internal/db"
	"github.com/nnc/university-reports-creator/service-document/internal/grpcserver"
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

	srv := grpcserver.New(
		func(s *grpc.Server) { pbDocument.RegisterDocumentServiceServer(s, svcs.Document) },
		func(s *grpc.Server) { pbTemplate.RegisterTemplateServiceServer(s, svcs.Template) },
	)

	if err := grpcserver.Run(srv, cfg.GRPCPort); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}
