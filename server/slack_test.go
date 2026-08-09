package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
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

func TestParseInteractivityPayload(t *testing.T) {
	raw := `{"type":"block_actions","response_url":"https://hooks.slack.com/actions/x","user":{"id":"U0ADMIN"},"actions":[{"action_id":"end_order","value":"order-123"}]}`
	payload, err := parseInteractivityPayload(url.Values{"payload": {raw}})
	if err != nil || payload.User.ID != "U0ADMIN" || payload.Actions[0].Value != "order-123" || payload.ResponseURL == "" {
		t.Fatalf("payload = %#v, err = %v", payload, err)
	}
	for _, bad := range []string{
		`{"type":"view_submission","user":{"id":"U1"},"actions":[{"action_id":"end_order","value":"o"}]}`,
		`{"type":"block_actions","user":{"id":"U1"},"actions":[{"action_id":"other","value":"o"}]}`,
		`{"type":"block_actions","user":{"id":"U1"}}`,
		`not json`,
	} {
		if _, err := parseInteractivityPayload(url.Values{"payload": {bad}}); err == nil {
			t.Fatalf("accepted unsupported payload: %s", bad)
		}
	}
}

func TestEndOrderBlockShape(t *testing.T) {
	block := endOrderBlock("order-123")
	if block["type"] != "actions" {
		t.Fatalf("block type = %v", block["type"])
	}
	button := block["elements"].([]map[string]any)[0]
	if button["action_id"] != "end_order" || button["value"] != "order-123" || button["style"] != "danger" {
		t.Fatalf("button = %#v", button)
	}
	if button["confirm"] == nil {
		t.Fatal("danger button has no confirm dialog")
	}
}
