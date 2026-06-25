package model

import "time"

// RefreshToken mirrors the refresh_tokens table. Rotation family: reusing a
// revoked token revokes every token sharing its FamilyID (FR-AUTH-02).
type RefreshToken struct {
	ID        string
	UserID    string
	TokenHash string
	FamilyID  string
	ExpiresAt time.Time
	RevokedAt *time.Time
	CreatedAt time.Time
}

func (t *RefreshToken) Revoked() bool {
	return t.RevokedAt != nil
}

func (t *RefreshToken) Expired(now time.Time) bool {
	return now.After(t.ExpiresAt)
}
