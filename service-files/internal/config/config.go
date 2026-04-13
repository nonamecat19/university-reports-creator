package config

import (
	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"

	"github.com/nnc/university-reports-creator/pkg/shared/config"
)

type MinioConfig struct {
	Endpoint  string `env:"MINIO_ENDPOINT" envDefault:"localhost:9000"`
	AccessKey string `env:"MINIO_ACCESS_KEY" envDefault:"minioadmin"`
	SecretKey string `env:"MINIO_SECRET_KEY" envDefault:"minioadmin"`
	Bucket    string `env:"MINIO_BUCKET" envDefault:"files"`
	UseSSL    bool   `env:"MINIO_USE_SSL" envDefault:"false"`
}

type Config struct {
	config.BaseConfig
	Minio MinioConfig `envPrefix:""`
}

func Load() (*Config, error) {
	_ = godotenv.Load()
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
