package token

import (
	"crypto/rsa"
	"time"

	"github.com/google/uuid"

	"github.com/nnc/university-reports-creator/pkg/shared/jwtauth"
)

// JWTManager issues and validates RS256 access tokens (FR-AUTH-01/03). Refresh
// tokens are opaque, server-side records (see RefreshTokenGenerator) — not JWTs
// — so they can be looked up, rotated, and revoked without decoding.
type JWTManager struct {
	privateKey          *rsa.PrivateKey
	publicKey           *rsa.PublicKey
	accessTokenDuration time.Duration
}

func NewJWTManager(priv *rsa.PrivateKey, pub *rsa.PublicKey, accessDur time.Duration) *JWTManager {
	return &JWTManager{
		privateKey:          priv,
		publicKey:           pub,
		accessTokenDuration: accessDur,
	}
}

func (m *JWTManager) GenerateAccessToken(userID, email, name string) (string, error) {
	return jwtauth.Sign(m.privateKey, uuid.NewString(), userID, email, name, m.accessTokenDuration)
}

func (m *JWTManager) ValidateToken(tokenStr string) (*jwtauth.Claims, error) {
	return jwtauth.Verify(m.publicKey, tokenStr)
}
