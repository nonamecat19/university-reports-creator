-- name: CreateUser :exec
INSERT INTO users (id, email, name, hashed_password, google_sub, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $6);

-- name: FindUserByEmail :one
SELECT id, email, name, hashed_password, google_sub, email_verified,
       university, faculty, department, student_group, supervisor,
       created_at, updated_at
FROM users
WHERE email = $1;

-- name: FindUserByID :one
SELECT id, email, name, hashed_password, google_sub, email_verified,
       university, faculty, department, student_group, supervisor,
       created_at, updated_at
FROM users
WHERE id = $1;

-- name: FindUserByGoogleSub :one
SELECT id, email, name, hashed_password, google_sub, email_verified,
       university, faculty, department, student_group, supervisor,
       created_at, updated_at
FROM users
WHERE google_sub = $1;

-- name: UpdateUserProfile :one
UPDATE users
SET name = $2, university = $3, faculty = $4, department = $5,
    student_group = $6, supervisor = $7, updated_at = $8
WHERE id = $1
RETURNING id, email, name, hashed_password, google_sub, email_verified,
          university, faculty, department, student_group, supervisor,
          created_at, updated_at;
