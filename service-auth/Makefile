include .env
export

.PHONY: proto build run dev test clean sqlc migrate-up migrate-down db-up db-down

proto:
	protoc -I proto \
		--go_out=gen --go_opt=paths=source_relative \
		--go-grpc_out=gen --go-grpc_opt=paths=source_relative \
		auth/auth.proto

build:
	go build -o bin/server ./cmd/server

run:
	go run ./cmd/server

dev:
	air

test:
	go test ./...

clean:
	rm -rf bin tmp gen

sqlc:
	sqlc generate

migrate-up:
	psql "$(DATABASE_URL)" -f sql/schema/001_users.sql

migrate-down:
	psql "$(DATABASE_URL)" -c "DROP TABLE IF EXISTS users;"

db-up:
	docker compose up -d

db-down:
	docker compose down
