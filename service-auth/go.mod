module github.com/nnc/university-reports-creator/service-auth

go 1.25.0

require (
	github.com/golang-jwt/jwt/v5 v5.3.0
	github.com/google/uuid v1.6.0
	github.com/joho/godotenv v1.5.1
	github.com/lib/pq v1.12.0
	github.com/nnc/university-reports-creator/gen/go v0.0.0
	github.com/nnc/university-reports-creator/pkg/shared v0.0.0
	github.com/pressly/goose/v3 v3.27.0
	golang.org/x/crypto v0.48.0
	google.golang.org/grpc v1.80.0
)

require (
	github.com/caarlos0/env/v11 v11.4.0 // indirect
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/mfridman/interpolate v0.0.2 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	github.com/sethvargo/go-retry v0.3.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/net v0.50.0 // indirect
	golang.org/x/sync v0.19.0 // indirect
	golang.org/x/sys v0.41.0 // indirect
	golang.org/x/text v0.34.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260217215200-42d3e9bedb6d // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)

replace github.com/nnc/university-reports-creator/gen/go => ../gen/go

replace github.com/nnc/university-reports-creator/pkg/shared => ../pkg/shared
