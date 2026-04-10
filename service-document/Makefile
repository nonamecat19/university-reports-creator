include .env
export

.PHONY: proto build run dev test clean db-up db-down

proto:
	protoc -I proto \
		--go_out=gen --go_opt=paths=source_relative \
		--go-grpc_out=gen --go-grpc_opt=paths=source_relative \
		document/document.proto \
		template/template.proto

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

db-up:
	docker compose up -d

db-down:
	docker compose down
