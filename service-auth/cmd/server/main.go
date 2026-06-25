package main

import (
	"context"
	"database/sql"
	"embed"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/pressly/goose/v3"

	"github.com/nnc/university-reports-creator/gen/go/auth"
	"github.com/nnc/university-reports-creator/pkg/shared/config"
	grpcserver "github.com/nnc/university-reports-creator/pkg/shared/grpc"
	"github.com/nnc/university-reports-creator/pkg/shared/jwtauth"
	"github.com/nnc/university-reports-creator/service-auth/internal/repository"
	"github.com/nnc/university-reports-creator/service-auth/internal/service"
	"github.com/nnc/university-reports-creator/service-auth/internal/token"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type AuthConfig struct {
	config.BaseConfig
	JWTPrivateKeyPath    string `env:"JWT_PRIVATE_KEY_PATH,required"`
	JWTPublicKeyPath     string `env:"JWT_PUBLIC_KEY_PATH,required"`
	AccessTokenDuration  string `env:"ACCESS_TOKEN_DURATION" envDefault:"15m"`
	RefreshTokenDuration string `env:"REFRESH_TOKEN_DURATION" envDefault:"720h"`
	DatabaseURL          string `env:"DATABASE_URL"`
}

func main() {
	cfg, err := config.Load[AuthConfig]()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	accessDur, err := time.ParseDuration(cfg.AccessTokenDuration)
	if err != nil {
		slog.Error("invalid access token duration", "error", err)
		os.Exit(1)
	}

	refreshDur, err := time.ParseDuration(cfg.RefreshTokenDuration)
	if err != nil {
		slog.Error("invalid refresh token duration", "error", err)
		os.Exit(1)
	}

	privKey, err := jwtauth.LoadPrivateKeyFromFile(cfg.JWTPrivateKeyPath)
	if err != nil {
		slog.Error("failed to load JWT private key", "error", err)
		os.Exit(1)
	}
	pubKey, err := jwtauth.LoadPublicKeyFromFile(cfg.JWTPublicKeyPath)
	if err != nil {
		slog.Error("failed to load JWT public key", "error", err)
		os.Exit(1)
	}

	conn, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer conn.Close()

	if err := conn.Ping(); err != nil {
		slog.Error("failed to ping database", "error", err)
		os.Exit(1)
	}

	goose.SetBaseFS(migrationsFS)
	if err := goose.UpContext(context.Background(), conn, "migrations"); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	userRepo := repository.NewUserRepository(conn)
	refreshRepo := repository.NewRefreshTokenRepository(conn)
	tokenManager := token.NewJWTManager(privKey, pubKey, accessDur)
	authService := service.NewAuthService(userRepo, refreshRepo, tokenManager, refreshDur)

	srv := grpcserver.New()
	auth.RegisterAuthServiceServer(srv.Server(), authService)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go srv.Run(cfg.GRPCPort)

	<-ctx.Done()
	slog.Info("shutting down service-auth...")
}
