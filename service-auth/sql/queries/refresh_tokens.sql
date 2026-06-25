-- name: CreateRefreshToken :exec
INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at, created_at)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: FindRefreshTokenByHash :one
SELECT id, user_id, token_hash, family_id, expires_at, revoked_at, created_at
FROM refresh_tokens
WHERE token_hash = $1;

-- name: RevokeRefreshToken :exec
UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1;

-- name: RevokeRefreshTokenFamily :exec
UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL;
