.PHONY: help env-setup build build-auth build-document build-files build-gateway generate dev \
dev-auth dev-document dev-files dev-gateway \
infra-up infra-down infra-logs \
k8s-up k8s-down k8s-deploy k8s-delete k8s-logs k8s-port-forward k8s-build k8s-load-images clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' Makefile | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ============================================================================
# Setup
# ============================================================================

env-setup: ## Copy .env.example to .env for all services
	@cp -n service-auth/.env.example service-auth/.env || true
	@cp -n service-document/.env.example service-document/.env || true
	@cp -n service-files/.env.example service-files/.env || true
	@cp -n service-gateway/.env.example service-gateway/.env || true
	@echo "Created .env files from .env.example"

# ============================================================================
# Build (manual, rarely needed)
# ============================================================================

build: build-auth build-document build-files build-gateway ## Build all services

build-auth:
	go work sync && CGO_ENABLED=0 go build -o dist/service-auth ./service-auth/cmd/server

build-document:
	go work sync && CGO_ENABLED=0 go build -o dist/service-document ./service-document/cmd/server

build-files:
	go work sync && CGO_ENABLED=0 go build -o dist/service-files ./service-files/cmd/server

build-gateway:
	go work sync && CGO_ENABLED=0 go build -o dist/service-gateway ./service-gateway/cmd/server

# ============================================================================
# Generate
# ============================================================================

proto: ## Generate protobuf code
	./node_modules/.bin/buf generate

generate: proto ## Generate protobuf and tidy modules
	cd gen/go && go mod tidy
	cd pkg/shared && go mod tidy

# ============================================================================
# Local Development (Air) - primary workflow
# ============================================================================

dev: dev-auth dev-document dev-files dev-gateway ## Run all services with hot reload

dev-auth: ## Run auth service with hot reload
	cd service-auth && air -c air.toml

dev-document: ## Run document service with hot reload
	cd service-document && air -c air.toml

dev-files: ## Run files service with hot reload
	cd service-files && air -c air.toml

dev-gateway: ## Run gateway service with hot reload
	cd service-gateway && air -c air.toml

# ============================================================================
# Infrastructure (Docker Compose)
# ============================================================================

infra-up: ## Start PostgreSQL, SurrealDB, MinIO
	docker compose up -d postgres surrealdb minio

infra-down: ## Stop infra services
	docker compose down

infra-logs: ## View infra logs
	docker compose logs -f postgres surrealdb minio

# ============================================================================
# Kubernetes (k3d)
# ============================================================================

K8S_NAMESPACE := university-reports
K8S_CLUSTER := university-reports

k8s-up: ## Start local k3d cluster
	@if ! k3d cluster list $(K8S_CLUSTER) 2>/dev/null; then \
		k3d cluster create $(K8S_CLUSTER) \
			--servers 1 \
			--agents 2 \
			--port "80:80@loadbalancer" \
			--port "443:443@loadbalancer" \
			--port "5432:5432@loadbalancer" \
			--port "8000:8000@loadbalancer" \
			--port "9000:9000@loadbalancer" \
			--k3s-arg "--disable=traefik@server:0"; \
	fi
	@echo "k3d cluster ready"

k8s-down: ## Stop k3d cluster
	k3d cluster delete $(K8S_CLUSTER) 2>/dev/null || true

k8s-deploy: k8s-build k8s-load-images ## Deploy to k3d
	kubectl apply -k k8s/overlays/dev
	@echo "Deployed. Run 'make k8s-port-forward' to access"

k8s-build: ## Build Docker images for K8s
	docker build -t university-reports-creator/service-auth:latest -f service-auth/Dockerfile .
	docker build -t university-reports-creator/service-document:latest -f service-document/Dockerfile .
	docker build -t university-reports-creator/service-files:latest -f service-files/Dockerfile .
	docker build -t university-reports-creator/service-gateway:latest -f service-gateway/Dockerfile .

k8s-load-images: ## Load images into k3d
	k3d image import university-reports-creator/service-auth:latest -c $(K8S_CLUSTER)
	k3d image import university-reports-creator/service-document:latest -c $(K8S_CLUSTER)
	k3d image import university-reports-creator/service-files:latest -c $(K8S_CLUSTER)
	k3d image import university-reports-creator/service-gateway:latest -c $(K8S_CLUSTER)

k8s-delete: ## Delete deployment
	kubectl delete namespace $(K8S_NAMESPACE) --cascade=foreground 2>/dev/null || true

k8s-logs: ## View pod logs
	kubectl logs -f --namespace=$(K8S_NAMESPACE) -l app.kubernetes.io/name=university-reports-creator

k8s-port-forward: ## Port forward to gateway
	kubectl port-forward -n $(K8S_NAMESPACE) svc/service-gateway 8080:8080

# ============================================================================
# Cleanup
# ============================================================================

clean: ## Clean build artifacts
	rm -rf dist/
