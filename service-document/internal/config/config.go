package config

import (
	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"

	"github.com/nnc/university-reports-creator/pkg/shared/config"
)

type SurrealDBConfig struct {
	URL       string `env:"SURREALDB_URL" envDefault:"ws://localhost:8000"`
	Username  string `env:"SURREALDB_USERNAME" envDefault:"root"`
	Password  string `env:"SURREALDB_PASSWORD" envDefault:"root"`
	Namespace string `env:"SURREALDB_NAMESPACE" envDefault:"diploma"`
	Database  string `env:"SURREALDB_DATABASE" envDefault:"main"`
}

type Config struct {
	config.BaseConfig
	SurrealDB SurrealDBConfig `envPrefix:""`

	// Sanctioned service->service edge (FR-ARC-07): service-document orchestrates
	// template parsing and export via service-render, resolving bytes via
	// service-files first.
	ServiceRender string `env:"SERVICE_RENDER" envDefault:"localhost:50054"`
	ServiceFiles  string `env:"SERVICE_FILES" envDefault:"localhost:50053"`
}

func Load() (*Config, error) {
	_ = godotenv.Load()
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
