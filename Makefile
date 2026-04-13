.PHONY: help build build-auth build-document build-gateway generate run up down clean proto docker-build docker-up docker-down

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' Makefile | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: build-auth build-document build-gateway ## Build all services

build-auth: ## Build service-auth
	go work sync && CGO_ENABLED=0 go build -o dist/service-auth ./service-auth/cmd/server

build-document: ## Build service-document
	go work sync && CGO_ENABLED=0 go build -o dist/service-document ./service-document/cmd/server

build-gateway: ## Build service-gateway
	go work sync && CGO_ENABLED=0 go build -o dist/service-gateway ./service-gateway/cmd/server

proto: ## Generate protobuf code
	./node_modules/.bin/buf generate

generate: proto ## Generate protobuf and tidy modules
	cd gen/go && go mod tidy
	cd pkg/shared && go mod tidy

run: build ## Run services locally (requires postgres and surrealdb)
	./dist/service-auth &
	./dist/service-document &
	./dist/service-gateway

docker-build: ## Build Docker images
	docker compose build

docker-up: ## Start all services with Docker
	docker compose up -d

docker-down: ## Stop all Docker services
	docker compose down

up: proto docker-build docker-up ## Build and start all services

down: docker-down ## Stop all services

clean: ## Clean build artifacts
	rm -rf dist/
	rm -rf gen/go/**/*.pb.go
	rm -rf gen/go/**/*_grpc.pb.go
	rm -rf gen/go/**/go.sum
