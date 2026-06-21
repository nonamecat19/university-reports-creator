package config

import (
	"os"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	GRPCPort             string
	JWTSecret            string
	AccessTokenDuration  time.Duration
	RefreshTokenDuration time.Duration
	DatabaseURL          string
	SupabaseURL          string
	SupabaseAnonKey      string
	SupabaseServiceKey   string
}

func Load() (*Config, error) {
	_ = godotenv.Load()

	cfg := &Config{
		GRPCPort:           getEnv("GRPC_PORT", ":50051"),
		JWTSecret:          getEnv("JWT_SECRET", "dev-secret-change-me"),
		DatabaseURL:        getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/auth?sslmode=disable"),
		SupabaseURL:        getEnv("SUPABASE_URL", ""),
		SupabaseAnonKey:    getEnv("SUPABASE_ANON_KEY", ""),
		SupabaseServiceKey: getEnv("SUPABASE_SERVICE_KEY", ""),
	}

	var err error
	cfg.AccessTokenDuration, err = time.ParseDuration(getEnv("ACCESS_TOKEN_DURATION", "15m"))
	if err != nil {
		return nil, err
	}

	cfg.RefreshTokenDuration, err = time.ParseDuration(getEnv("REFRESH_TOKEN_DURATION", "168h"))
	if err != nil {
		return nil, err
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
