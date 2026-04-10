package db

import (
	"context"
	"fmt"

	surrealdb "github.com/surrealdb/surrealdb.go"

	"github.com/nnc/university-reports-creator/service-document/internal/config"
)

func Connect(ctx context.Context, cfg config.SurrealDBConfig) (*surrealdb.DB, error) {
	db, err := surrealdb.FromEndpointURLString(ctx, cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("connect to surrealdb: %w", err)
	}

	token, err := db.SignIn(ctx, &surrealdb.Auth{
		Username: cfg.Username,
		Password: cfg.Password,
	})
	if err != nil {
		return nil, fmt.Errorf("sign in to surrealdb: %w", err)
	}
	if err = db.Authenticate(ctx, token); err != nil {
		return nil, fmt.Errorf("authenticate with surrealdb: %w", err)
	}

	if err = db.Use(ctx, cfg.Namespace, cfg.Database); err != nil {
		return nil, fmt.Errorf("select namespace/database: %w", err)
	}

	return db, nil
}
