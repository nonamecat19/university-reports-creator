GO_SERVICES = auth document files gateway
ALL_SERVICES = auth document files gateway ai render
K8S_NAMESPACE := university-reports
K8S_CLUSTER := university-reports
IMAGE_PREFIX := university-reports-creator
DATABASE_URL ?= postgres://postgres:postgres@localhost:5432/auth?sslmode=disable

.PHONY: help setup env-setup certs \
	build build-auth build-document build-files build-gateway build-ai build-render \
	proto generate \
	dev dev-auth dev-document dev-files dev-gateway dev-ai dev-render dev-stop \
	client-dev client-build client-test client-lint client-format \
	client-e2e client-e2e-smoke client-e2e-install \
	lint lint-go lint-ts lint-proto \
	format format-go format-ts format-proto \
	test test-go test-ts test-python \
	migrate-up migrate-down \
	infra-up infra-down infra-logs \
	docker-build \
	k8s-up k8s-down k8s-deploy k8s-build k8s-load-images k8s-delete k8s-logs k8s-port-forward k8s-restart \
	status clean

# ============================================================================
# Help
# ============================================================================

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' Makefile | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ============================================================================
# Setup
# ============================================================================

setup: env-setup certs infra-up generate ## Full project setup (first-time)
	@echo "Project setup complete"

env-setup: ## Copy .env.example to .env for all services
	@cp -n service-auth/.env.example service-auth/.env || true
	@cp -n service-document/.env.example service-document/.env || true
	@cp -n service-files/.env.example service-files/.env || true
	@cp -n service-gateway/.env.example service-gateway/.env || true
	@cp -n service-ai/.env.example service-ai/.env || true
	@cp -n service-render/.env.example service-render/.env || true
	@echo "Created .env files from .env.example"

certs: ## Generate a local dev RS256 keypair for JWT signing (FR-AUTH-03)
	@mkdir -p certs
	@if [ ! -f certs/jwt_private.pem ]; then \
		openssl genrsa -out certs/jwt_private.pem 2048 2>/dev/null; \
		openssl rsa -in certs/jwt_private.pem -pubout -out certs/jwt_public.pem 2>/dev/null; \
		echo "Generated certs/jwt_private.pem + certs/jwt_public.pem"; \
	else \
		echo "certs/jwt_private.pem already exists, skipping"; \
	fi

# ============================================================================
# Build (manual, rarely needed)
# ============================================================================

build: build-auth build-document build-files build-gateway ## Build all Go services

build-auth: ## Build service-auth
	go work sync && CGO_ENABLED=0 go build -o dist/service-auth ./service-auth/cmd/server

build-document: ## Build service-document
	go work sync && CGO_ENABLED=0 go build -o dist/service-document ./service-document/cmd/server

build-files: ## Build service-files
	go work sync && CGO_ENABLED=0 go build -o dist/service-files ./service-files/cmd/server

build-gateway: ## Build service-gateway
	go work sync && CGO_ENABLED=0 go build -o dist/service-gateway ./service-gateway/cmd/server

build-ai: ## Generate Python proto stubs for service-ai
	cd service-ai && uv run python -c "from ai.__main__ import generate_proto_stubs; generate_proto_stubs()"

build-render: ## Generate Python proto stubs for service-render
	cd service-render && uv run python -c "from render.__main__ import generate_proto_stubs; generate_proto_stubs()"

# ============================================================================
# Generate
# ============================================================================

proto: ## Generate protobuf code
	./node_modules/.bin/buf generate

generate: proto ## Generate protobuf code and tidy Go modules
	cd gen/go && go mod tidy
	cd pkg/shared && go mod tidy
	cd service-auth && go mod tidy
	cd service-document && go mod tidy
	cd service-files && go mod tidy
	cd service-gateway && go mod tidy

# ============================================================================
# Local Development (Air) - primary workflow
# ============================================================================

dev: infra-up ## Start all services with hot reload (parallel)
	@$(MAKE) dev-auth & \
	$(MAKE) dev-document & \
	$(MAKE) dev-files & \
	$(MAKE) dev-gateway & \
	$(MAKE) dev-ai & \
	$(MAKE) dev-render & \
	wait

dev-auth: ## Run auth service with hot reload
	cd service-auth && air -c air.toml

dev-document: ## Run document service with hot reload
	cd service-document && air -c air.toml

dev-files: ## Run files service with hot reload
	cd service-files && air -c air.toml

dev-gateway: ## Run gateway service with hot reload
	cd service-gateway && air -c air.toml

dev-ai: ## Run service-ai with hot reload
	cd service-ai && uv run python -m ai

dev-render: ## Run service-render with hot reload
	cd service-render && uv run python -m render

dev-stop: ## Stop all hot-reload dev processes
	@pkill -f "air" 2>/dev/null || true
	@pkill -f "python -m ai" 2>/dev/null || true
	@pkill -f "python -m render" 2>/dev/null || true
	@pkill -f "ng serve" 2>/dev/null || true
	@echo "Stopped all dev processes"

# ============================================================================
# Client (Angular)
# ============================================================================

client-dev: ## Start Angular dev server
	cd client && ng serve

client-build: ## Build Angular for production
	cd client && ng build

client-test: ## Run Angular tests (single run)
	cd client && ng test --watch=false

client-lint: ## Lint Angular with Biome
	cd client && npx biome check src/

client-format: ## Format Angular with Biome
	cd client && npx biome format src/ --write

client-e2e: ## Run mocked Playwright e2e tests (fast, no backend needed)
	cd client && npx playwright test --project=mocked

client-e2e-smoke: ## Run real-stack Playwright smoke test (requires make dev + make client-dev)
	cd client && E2E_SMOKE=1 npx playwright test --project=smoke

client-e2e-install: ## Install Playwright browsers
	cd client && npx playwright install --with-deps chromium

# ============================================================================
# Linting
# ============================================================================

lint: lint-go lint-ts lint-proto ## Lint all code

lint-go: ## Lint Go services with go vet
	@for svc in $(GO_SERVICES); do \
		echo "Linting service-$$svc..."; \
		cd service-$$svc && go vet ./... && cd ..; \
	done

lint-ts: ## Lint TypeScript (Angular) with Biome
	cd client && npx biome check src/

lint-proto: ## Lint Protobuf with buf
	./node_modules/.bin/buf lint

# ============================================================================
# Formatting
# ============================================================================

format: format-go format-ts format-proto ## Format all code

format-go: ## Format Go code with gofmt
	gofmt -w service-auth/ service-document/ service-files/ service-gateway/ pkg/

format-ts: ## Format TypeScript code with Biome
	cd client && npx biome format src/ --write

format-proto: ## Format Protobuf code with buf
	./node_modules/.bin/buf format -w

# ============================================================================
# Testing
# ============================================================================

test: test-go test-ts test-python client-e2e ## Run all tests

test-go: ## Run Go tests
	@for svc in $(GO_SERVICES); do \
		echo "Testing service-$$svc..."; \
		cd service-$$svc && go test ./... && cd ..; \
	done

test-ts: ## Run Angular tests (single run)
	cd client && ng test --watch=false

test-python: ## Run Python tests
	cd service-ai && uv run pytest
	cd service-render && uv run pytest

# ============================================================================
# Database Migrations (service-auth)
# ============================================================================

migrate-up: ## Run database migrations for service-auth
	cd service-auth && goose -dir=cmd/server/migrations postgres "$(DATABASE_URL)" up

migrate-down: ## Rollback last migration for service-auth
	cd service-auth && goose -dir=cmd/server/migrations postgres "$(DATABASE_URL)" down

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
# Docker
# ============================================================================

docker-build: ## Build all Docker images
	@for svc in $(GO_SERVICES); do \
		echo "Building service-$$svc..."; \
		docker build -t $(IMAGE_PREFIX)/service-$$svc:latest -f service-$$svc/Dockerfile .; \
	done
	@echo "Building service-ai..."
	docker build -t $(IMAGE_PREFIX)/service-ai:latest -f service-ai/Dockerfile .
	@echo "Building service-render..."
	docker build -t $(IMAGE_PREFIX)/service-render:latest -f service-render/Dockerfile .

# ============================================================================
# Kubernetes (k3d)
# ============================================================================

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
	@for svc in $(ALL_SERVICES); do \
		echo "Building service-$$svc..."; \
		docker build -t $(IMAGE_PREFIX)/service-$$svc:latest -f service-$$svc/Dockerfile .; \
	done

k8s-load-images: ## Load images into k3d
	@for svc in $(ALL_SERVICES); do \
		echo "Loading service-$$svc..."; \
		k3d image import $(IMAGE_PREFIX)/service-$$svc:latest -c $(K8S_CLUSTER); \
	done

k8s-delete: ## Delete deployment
	kubectl delete namespace $(K8S_NAMESPACE) --cascade=foreground 2>/dev/null || true

k8s-logs: ## View pod logs
	kubectl logs -f --namespace=$(K8S_NAMESPACE) -l app.kubernetes.io/name=university-reports-creator

k8s-port-forward: ## Port forward to gateway
	kubectl port-forward -n $(K8S_NAMESPACE) svc/service-gateway 8080:8080

k8s-restart: ## Restart all deployments
	kubectl rollout restart -n $(K8S_NAMESPACE) --all deployments

# ============================================================================
# Status
# ============================================================================

status: ## Show status of all services and infrastructure
	@echo "=== Docker Infrastructure ==="
	@docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "Docker Compose not running"
	@echo ""
	@echo "=== Dev Processes (air) ==="
	@pgrep -fa "air" 2>/dev/null || echo "No air processes running"
	@pgrep -fa "python -m ai" 2>/dev/null || echo "No AI service running"
	@echo ""
	@echo "=== Angular Dev Server ==="
	@pgrep -fa "ng serve" 2>/dev/null || echo "No Angular dev server running"
	@echo ""
	@echo "=== Kubernetes ==="
	@kubectl get pods -n $(K8S_NAMESPACE) 2>/dev/null || echo "No K8s namespace found"

# ============================================================================
# Cleanup
# ============================================================================

clean: dev-stop ## Stop dev processes and clean build artifacts
	rm -rf dist/
	cd client && rm -rf .angular/cache 2>/dev/null || true
