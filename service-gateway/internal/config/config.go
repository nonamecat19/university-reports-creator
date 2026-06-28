package config

import (
	"github.com/nnc/university-reports-creator/pkg/shared/config"
)

type Config struct {
	HTTPPort         string `env:"HTTP_PORT" envDefault:":8080"`
	JWTPublicKeyPath string `env:"JWT_PUBLIC_KEY_PATH,required"`
	ServiceAuth      string `env:"SERVICE_AUTH" envDefault:"localhost:50051"`
	ServiceDocument  string `env:"SERVICE_DOCUMENT" envDefault:"localhost:50052"`
	ServiceFiles     string `env:"SERVICE_FILES" envDefault:"localhost:50053"`
	ClientOrigin     string `env:"CLIENT_ORIGIN" envDefault:"http://localhost:4200"`
}

func Load() (*Config, error) {
	return config.Load[Config]()
}
