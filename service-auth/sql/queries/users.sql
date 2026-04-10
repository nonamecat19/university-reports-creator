-- name: CreateUser :exec
INSERT INTO users (id, email, name, hashed_password, created_at)
VALUES ($1, $2, $3, $4, $5);

-- name: FindUserByEmail :one
SELECT id, email, name, hashed_password, created_at
FROM users
WHERE email = $1;

-- name: FindUserByID :one
SELECT id, email, name, hashed_password, created_at
FROM users
WHERE id = $1;
