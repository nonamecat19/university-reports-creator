package config

import (
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	GRPCPort  string         `mapstructure:"GRPC_PORT"`
	SurrealDB SurrealDBConfig `mapstructure:",squash"`
}

type SurrealDBConfig struct {
	URL       string `mapstructure:"SURREALDB_URL"`
	Username  string `mapstructure:"SURREALDB_USERNAME"`
	Password  string `mapstructure:"SURREALDB_PASSWORD"`
	Namespace string `mapstructure:"SURREALDB_NAMESPACE"`
	Database  string `mapstructure:"SURREALDB_DATABASE"`
}

func Load() (*Config, error) {
	viper.SetConfigFile(".env")
	viper.SetConfigType("env")
	viper.AutomaticEnv()
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	viper.SetDefault("GRPC_PORT", ":50052")
	viper.SetDefault("SURREALDB_URL", "ws://localhost:8000")
	viper.SetDefault("SURREALDB_USERNAME", "root")
	viper.SetDefault("SURREALDB_PASSWORD", "root")
	viper.SetDefault("SURREALDB_NAMESPACE", "diploma")
	viper.SetDefault("SURREALDB_DATABASE", "main")

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, err
		}
	}

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}
