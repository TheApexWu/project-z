package main

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"
	"time"
)

func TestBuildScopedCardRequestAppliesRules(t *testing.T) {
	now := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	body := buildScopedCardRequest(4299, rainRules{AllowedMccs: []string{"5812", "5814"}, ExpiresInDays: 30}, now)
	if body["amountInUSDCents"] != 4299 {
		t.Fatalf("amountInUSDCents = %v, want 4299", body["amountInUSDCents"])
	}
	mccs, ok := body["allowedMccs"].([]string)
	if !ok || len(mccs) != 2 || mccs[0] != "5812" {
		t.Fatalf("allowedMccs = %v, want [5812 5814]", body["allowedMccs"])
	}
	if body["expiresAt"] != "2026-09-08T12:00:00Z" {
		t.Fatalf("expiresAt = %v, want 2026-09-08T12:00:00Z", body["expiresAt"])
	}
}

func TestBuildScopedCardRequestOmitsUnsetRules(t *testing.T) {
	body := buildScopedCardRequest(100, rainRules{}, time.Now())
	if _, present := body["allowedMccs"]; present {
		t.Fatal("allowedMccs present despite empty rule")
	}
	if _, present := body["expiresAt"]; present {
		t.Fatal("expiresAt present despite zero expiresInDays")
	}
	if body["amountInUSDCents"] != 100 {
		t.Fatalf("amountInUSDCents = %v, want uncapped 100", body["amountInUSDCents"])
	}
}

func TestBuildScopedCardRequestAmountCap(t *testing.T) {
	body := buildScopedCardRequest(938, rainRules{AmountCapCents: 500}, time.Now())
	if body["amountInUSDCents"] != 500 {
		t.Fatalf("amountInUSDCents = %v, want capped 500", body["amountInUSDCents"])
	}
	if got := buildScopedCardRequest(938, rainRules{AmountCapCents: 5000}, time.Now())["amountInUSDCents"]; got != 938 {
		t.Fatalf("cap above total changed the amount: %v", got)
	}
}

func TestGenerateSessionIDShape(t *testing.T) {
	block, _ := pem.Decode([]byte(rainSandboxPublicKeyPEM))
	keyAny, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	publicKey, ok := keyAny.(*rsa.PublicKey)
	if !ok {
		t.Fatal("sandbox key is not RSA")
	}
	secret, sessionID, err := generateSessionID(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	if len(secret) != 32 {
		t.Fatalf("secret length = %d, want 32 hex chars", len(secret))
	}
	if len(sessionID) == 0 {
		t.Fatal("session id is empty")
	}
	// Sanity: OAEP ciphertext for a 1024-bit key is 128 bytes -> 172 base64 chars.
	if len(sessionID) != 172 {
		t.Fatalf("session id length = %d, want 172", len(sessionID))
	}
}
