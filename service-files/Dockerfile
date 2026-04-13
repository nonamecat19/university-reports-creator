FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY gen/go ../gen/go
COPY pkg/shared ../pkg/shared

COPY service-files/go.mod service-files/go.sum ./
RUN go mod download
COPY service-files ./
RUN cd /app && go mod tidy && CGO_ENABLED=0 go build -o /server ./cmd/server

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /server /server
EXPOSE 50053
ENTRYPOINT ["/server"]
