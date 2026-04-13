package config

import (
	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

func Load[T any]() (*T, error) {
	_ = godotenv.Load()
	var cfg T
	if err := env.Parse(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

type BaseConfig struct {
	GRPCPort string `env:"GRPC_PORT" envDefault:":50051"`
}
