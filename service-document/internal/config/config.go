package config

import (
	"github.com/caarlos0/env/v11"
)

type Config struct {
	GRPCPort  string `env:"GRPC_PORT" envDefault:":50052"`
	SurrealDB SurrealDBConfig
}

type SurrealDBConfig struct {
	URL       string `env:"SURREALDB_URL" envDefault:"ws://localhost:8000"`
	Username  string `env:"SURREALDB_USERNAME" envDefault:"root"`
	Password  string `env:"SURREALDB_PASSWORD" envDefault:"root"`
	Namespace string `env:"SURREALDB_NAMESPACE" envDefault:"diploma"`
	Database  string `env:"SURREALDB_DATABASE" envDefault:"main"`
}

func Load() (*Config, error) {
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
