module github.com/nnc/university-reports-creator/service-gateway

go 1.25.6

require (
	connectrpc.com/connect v1.19.1
	github.com/nnc/university-reports-creator/gen/go v0.0.0
	github.com/rs/cors v1.11.0
	google.golang.org/protobuf v1.36.11
)

require (
	go.opentelemetry.io/otel v1.40.0 // indirect
	golang.org/x/net v0.50.0 // indirect
	golang.org/x/sys v0.41.0 // indirect
	golang.org/x/text v0.34.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260217215200-42d3e9bedb6d // indirect
	google.golang.org/grpc v1.80.0 // indirect
)

replace github.com/nnc/university-reports-creator/gen/go => ../gen/go
