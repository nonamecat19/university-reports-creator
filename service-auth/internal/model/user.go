package model

import "time"

// User mirrors the users table (FR-DAT: Postgres users). Nullable fields use
// pointers so a nil value round-trips as SQL NULL.
type User struct {
	ID             string
	Email          string
	Name           string
	HashedPassword string // "" for Google-only accounts
	GoogleSub      string // "" when not linked to Google
	EmailVerified  bool
	University     string
	Faculty        string
	Department     string
	StudentGroup   string
	Supervisor     string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// HasPassword reports whether the account can authenticate with a password.
func (u *User) HasPassword() bool {
	return u.HashedPassword != ""
}
