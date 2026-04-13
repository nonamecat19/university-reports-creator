module github.com/nnc/university-reports-creator/service-document

go 1.25.0

require (
	github.com/caarlos0/env/v11 v11.4.0
	github.com/joho/godotenv v1.5.1
	github.com/nnc/university-reports-creator/gen/go v0.0.0
	github.com/nnc/university-reports-creator/pkg/shared v0.0.0
	github.com/surrealdb/surrealdb.go v1.4.0
	google.golang.org/grpc v1.80.0
)

require (
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/fxamacker/cbor/v2 v2.9.1 // indirect
	github.com/gofrs/uuid v4.4.0+incompatible // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/klauspost/compress v1.18.4 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	github.com/stretchr/testify v1.11.1 // indirect
	github.com/x448/float16 v0.8.4 // indirect
	go.opentelemetry.io/otel/metric v1.40.0 // indirect
	go.opentelemetry.io/otel/trace v1.40.0 // indirect
	golang.org/x/net v0.50.0 // indirect
	golang.org/x/sys v0.41.0 // indirect
	golang.org/x/text v0.34.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260217215200-42d3e9bedb6d // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)

replace github.com/nnc/university-reports-creator/gen/go => ../gen/go
replace github.com/nnc/university-reports-creator/pkg/shared => ../pkg/shared
