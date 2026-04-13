FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY gen/go ../gen/go

COPY service-gateway/go.mod service-gateway/go.sum ./
RUN go mod download
COPY service-gateway ./
RUN cd /app && go mod tidy && CGO_ENABLED=0 go build -o /server ./cmd/server

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
