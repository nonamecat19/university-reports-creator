-- +goose Up
-- +goose StatementBegin
ALTER TABLE users ALTER COLUMN hashed_password DROP NOT NULL;
ALTER TABLE users ADD COLUMN google_sub TEXT UNIQUE;
ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN university TEXT;
ALTER TABLE users ADD COLUMN faculty TEXT;
ALTER TABLE users ADD COLUMN department TEXT;
ALTER TABLE users ADD COLUMN student_group TEXT;
ALTER TABLE users ADD COLUMN supervisor TEXT;
ALTER TABLE users ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    family_id UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS refresh_tokens;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE users
    DROP COLUMN IF EXISTS google_sub,
    DROP COLUMN IF EXISTS email_verified,
    DROP COLUMN IF EXISTS university,
    DROP COLUMN IF EXISTS faculty,
    DROP COLUMN IF EXISTS department,
    DROP COLUMN IF EXISTS student_group,
    DROP COLUMN IF EXISTS supervisor,
    DROP COLUMN IF EXISTS updated_at;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE users ALTER COLUMN hashed_password SET NOT NULL;
-- +goose StatementEnd
