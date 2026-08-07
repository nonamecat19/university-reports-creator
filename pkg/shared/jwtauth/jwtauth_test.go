package jwtauth

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"
	"time"
)

func testKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return key
}

// The display name rides in the token so downstream services can attribute a
// write to a human without calling service-auth (FR-ARC-07).
func TestSignCarriesDisplayName(t *testing.T) {
	key := testKey(t)

	token, err := Sign(key, "jti", "user-1", "ivan@example.com", "Іван Іваненко", time.Minute)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	claims, err := Verify(&key.PublicKey, token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.Subject != "user-1" {
		t.Errorf("subject = %q, want user-1", claims.Subject)
	}
	if claims.Email != "ivan@example.com" {
		t.Errorf("email = %q", claims.Email)
	}
	if claims.Name != "Іван Іваненко" {
		t.Errorf("name = %q, want Іван Іваненко", claims.Name)
	}
}

// An account with no name set still yields a valid token; the gateway falls
// back to the email when populating x-user-name.
func TestSignWithoutNameStaysValid(t *testing.T) {
	key := testKey(t)

	token, err := Sign(key, "jti", "user-2", "no-name@example.com", "", time.Minute)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	claims, err := Verify(&key.PublicKey, token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.Name != "" {
		t.Errorf("name = %q, want empty", claims.Name)
	}
}
