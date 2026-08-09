package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestDoordashJWT(t *testing.T) {
	secret := []byte("test-signing-secret")
	client := &doordashClient{developerID: "dev-1", keyID: "key-1", secret: secret}
	now := time.Unix(1786200000, 0)
	token, err := client.jwt(now)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("expected 3 JWT parts, got %d", len(parts))
	}
	var header map[string]string
	decodePart(t, parts[0], &header)
	if header["alg"] != "HS256" || header["dd-ver"] != "DD-JWT-V1" || header["typ"] != "JWT" {
		t.Fatalf("bad header: %v", header)
	}
	var claims map[string]any
	decodePart(t, parts[1], &claims)
	if claims["aud"] != "doordash" || claims["iss"] != "dev-1" || claims["kid"] != "key-1" {
		t.Fatalf("bad claims: %v", claims)
	}
	if claims["iat"].(float64) != float64(now.Unix()) || claims["exp"].(float64) != float64(now.Add(5*time.Minute).Unix()) {
		t.Fatalf("bad iat/exp: %v", claims)
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	want := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(parts[2])) {
		t.Fatal("signature does not verify with the signing secret")
	}
}

func decodePart(t *testing.T, part string, out any) {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(part)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatal(err)
	}
}
