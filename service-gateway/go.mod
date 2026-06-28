module github.com/nnc/university-reports-creator/service-gateway

go 1.25.6

require (
	github.com/google/uuid v1.6.0
	github.com/improbable-eng/grpc-web v0.15.0
	github.com/mwitkow/grpc-proxy v0.0.0-20250813121105-2866842de9a5
	github.com/nnc/university-reports-creator/pkg/shared v0.0.0-00010101000000-000000000000
	google.golang.org/grpc v1.80.0
)

require (
	github.com/caarlos0/env/v11 v11.4.0 // indirect
	github.com/cenkalti/backoff/v4 v4.1.1 // indirect
	github.com/desertbit/timer v0.0.0-20180107155436-c41aec40b27f // indirect
	github.com/golang-jwt/jwt/v5 v5.3.1 // indirect
	github.com/joho/godotenv v1.5.1 // indirect
	github.com/klauspost/compress v1.11.7 // indirect
	github.com/rs/cors v1.11.0 // indirect
	github.com/stretchr/testify v1.11.1 // indirect
	go.opentelemetry.io/otel/metric v1.40.0 // indirect
	go.opentelemetry.io/otel/trace v1.40.0 // indirect
	golang.org/x/net v0.50.0 // indirect
	golang.org/x/sys v0.41.0 // indirect
	golang.org/x/text v0.34.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260217215200-42d3e9bedb6d // indirect
	google.golang.org/protobuf v1.36.11 // indirect
	nhooyr.io/websocket v1.8.6 // indirect
)

replace github.com/nnc/university-reports-creator/pkg/shared => ../pkg/shared
