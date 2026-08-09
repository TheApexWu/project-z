package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"
)

func TestBeginOrderParsing(t *testing.T) {
	got := parseBeginOrderLocally("<@U123> <@U456> $40 McDonald's 15m")
	if len(got.Users) != 2 || got.Users[0] != "U123" || got.BudgetCents != 4000 || got.Restaurant != "McDonald's" || got.Timer != "15m" {
		t.Fatalf("unexpected parse: %#v", got)
	}
}

func TestForgedSlackSignatureRejected(t *testing.T) {
	now := time.Now().UTC()
	body := []byte("command=%2Fbegin-order")
	if verifySlackRequest("secret", "0", "v0=forged", body, now) {
		t.Fatal("forged or stale Slack request was accepted")
	}
	mac := hmac.New(sha256.New, []byte("secret"))
	stamp := "1775736000"
	mac.Write([]byte("v0:" + stamp + ":" + string(body)))
	signature := "v0=" + hex.EncodeToString(mac.Sum(nil))
	validNow := time.Unix(1775736000, 0)
	if !verifySlackRequest("secret", stamp, signature, body, validNow) {
		t.Fatal("valid Slack signature was rejected")
	}
}
