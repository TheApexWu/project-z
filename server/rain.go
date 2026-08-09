package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Sandbox key from https://rain-sandbox-trial.mintlify.site/docs/resource-sessionid-keys
const rainSandboxPublicKeyPEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCAP192809jZyaw62g/eTzJ3P9H
+RmT88sXUYjQ0K8Bx+rJ83f22+9isKx+lo5UuV8tvOlKwvdDS/pVbzpG7D7NO45c
0zkLOXwDHZkou8fuj8xhDO5Tq3GzcrabNLRLVz3dkx0znfzGOhnY4lkOMIdKxlQb
LuVM/dGDC9UpulF+UwIDAQAB
-----END PUBLIC KEY-----`

type rainClient struct {
	baseURL              string
	apiKey               string
	userID               string
	collateralContractID string
	collateralChain      string
	http                 *http.Client
	publicKey            *rsa.PublicKey
}

// rainRules are the admin-panel client rules applied to every card creation.
// Empty AllowedMccs omits the MCC restriction; ExpiresInDays <= 0 omits expiry;
// AmountCapCents > 0 caps the card amount below the order total (agent-control
// program cap — the only rule visible on the Rain-side card object, via limit).
type rainRules struct {
	AllowedMccs    []string `json:"allowedMccs"`
	ExpiresInDays  int      `json:"expiresInDays"`
	AmountCapCents int      `json:"amountCapCents"`
}

func defaultRainRules() rainRules {
	// 5812 restaurants, 5814 fast food, 5411 grocery: food-only spend by default.
	return rainRules{AllowedMccs: []string{"5411", "5812", "5814"}, ExpiresInDays: 30}
}

func rainClientFromEnv() (*rainClient, error) {
	apiKey := os.Getenv("RAIN_API_KEY")
	userID := os.Getenv("RAIN_USER_ID")
	if apiKey == "" || userID == "" {
		return nil, errors.New("RAIN_API_KEY and RAIN_USER_ID are required")
	}
	baseURL := os.Getenv("RAIN_API_BASE")
	if baseURL == "" {
		baseURL = "https://api-dev.raincards.xyz/v1"
	}
	block, _ := pem.Decode([]byte(rainSandboxPublicKeyPEM))
	if block == nil {
		return nil, errors.New("rain sandbox public key PEM is invalid")
	}
	keyAny, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	publicKey, ok := keyAny.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("rain sandbox public key is not RSA")
	}
	return &rainClient{
		baseURL:              baseURL,
		apiKey:               apiKey,
		userID:               userID,
		collateralContractID: os.Getenv("COLLATERAL_CONTRACT_ID"),
		collateralChain:      os.Getenv("COLLATERAL_CHAIN"),
		http:                 &http.Client{Timeout: 15 * time.Second},
		publicKey:            publicKey,
	}, nil
}

// generateSessionID returns the hex secret and the RSA-OAEP(sha1) encrypted
// session id header value, per Rain's out-of-browser encryption docs.
func generateSessionID(publicKey *rsa.PublicKey) (string, string, error) {
	secretBytes := make([]byte, 16)
	if _, err := rand.Read(secretBytes); err != nil {
		return "", "", err
	}
	secretKey := fmt.Sprintf("%x", secretBytes)
	secretB64 := base64.StdEncoding.EncodeToString(secretBytes)
	ciphertext, err := rsa.EncryptOAEP(sha1.New(), rand.Reader, publicKey, []byte(secretB64), nil)
	if err != nil {
		return "", "", err
	}
	return secretKey, base64.StdEncoding.EncodeToString(ciphertext), nil
}

func buildScopedCardRequest(amountCents int, rules rainRules, now time.Time) map[string]any {
	if rules.AmountCapCents > 0 && rules.AmountCapCents < amountCents {
		amountCents = rules.AmountCapCents
	}
	body := map[string]any{"amountInUSDCents": amountCents}
	if len(rules.AllowedMccs) > 0 {
		body["allowedMccs"] = rules.AllowedMccs
	}
	if rules.ExpiresInDays > 0 {
		body["expiresAt"] = now.Add(time.Duration(rules.ExpiresInDays) * 24 * time.Hour).UTC().Format(time.RFC3339)
	}
	return body
}

type rainAttempt struct {
	At     time.Time       `json:"at"`
	Status int             `json:"status,omitempty"`
	Body   json.RawMessage `json:"body,omitempty"`
	Error  string          `json:"error,omitempty"`
}

type rainCardResult struct {
	CardID   string
	Request  map[string]any
	Response map[string]any
}

// createScopedCard mints one scoped card; retries once on network/5xx failure.
func (c *rainClient) createScopedCard(ctx context.Context, amountCents int, rules rainRules, now time.Time) (rainCardResult, error) {
	url := fmt.Sprintf("%s/issuing/users/%s/cards/scoped", c.baseURL, c.userID)
	requestBody := buildScopedCardRequest(amountCents, rules, now)
	result := rainCardResult{
		Request:  map[string]any{"method": http.MethodPost, "url": url, "body": requestBody},
		Response: map[string]any{"attempts": []rainAttempt{}},
	}
	attempts := []rainAttempt{}
	var cardID string
	var lastErr error
	for try := 0; try < 2; try++ {
		cardID, lastErr = c.createScopedCardOnce(ctx, url, requestBody, &attempts)
		result.Response["attempts"] = attempts
		if lastErr == nil {
			result.CardID = cardID
			return result, nil
		}
		var apiErr *rainAPIError
		if errors.As(lastErr, &apiErr) && apiErr.status < 500 {
			break // 4xx is a definitive rejection; retrying cannot help
		}
	}
	return result, lastErr
}

type rainAPIError struct {
	status int
	body   string
}

func (e *rainAPIError) Error() string {
	return fmt.Sprintf("rain API status %d: %s", e.status, e.body)
}

func (c *rainClient) createScopedCardOnce(ctx context.Context, url string, requestBody map[string]any, attempts *[]rainAttempt) (string, error) {
	attempt := rainAttempt{At: time.Now().UTC()}
	*attempts = append(*attempts, attempt)
	record := func(status int, body []byte, err error) {
		attempt.Status = status
		if json.Valid(body) {
			attempt.Body = json.RawMessage(body)
		} else if len(body) > 0 {
			attempt.Body, _ = json.Marshal(string(body))
		}
		if err != nil {
			attempt.Error = err.Error()
		}
		(*attempts)[len(*attempts)-1] = attempt
	}
	_, sessionID, err := generateSessionID(c.publicKey)
	if err != nil {
		record(0, nil, err)
		return "", err
	}
	payload, err := json.Marshal(requestBody)
	if err != nil {
		record(0, nil, err)
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		record(0, nil, err)
		return "", err
	}
	req.Header.Set("Api-Key", c.apiKey)
	req.Header.Set("sessionid", sessionID)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		record(0, nil, err)
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		record(resp.StatusCode, nil, err)
		return "", err
	}
	record(resp.StatusCode, body, nil)
	if resp.StatusCode/100 != 2 {
		return "", &rainAPIError{status: resp.StatusCode, body: string(body)}
	}
	var card struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &card); err != nil || card.ID == "" {
		return "", fmt.Errorf("rain card response missing id: %s", body)
	}
	return card.ID, nil
}

// loadRainRules overlays settings.rain_client_rules onto the defaults.
// Explicitly empty allowedMccs means "no MCC restriction"; explicit 0
// expiresInDays means "no expiry".
func loadRainRules(ctx context.Context, db *pgxpool.Pool) rainRules {
	rules := defaultRainRules()
	var raw []byte
	if err := db.QueryRow(ctx, `SELECT rain_client_rules FROM settings WHERE id = true`).Scan(&raw); err != nil {
		return rules
	}
	var stored struct {
		AllowedMccs    *[]string `json:"allowedMccs"`
		ExpiresInDays  *int      `json:"expiresInDays"`
		AmountCapCents *int      `json:"amountCapCents"`
	}
	if err := json.Unmarshal(raw, &stored); err != nil {
		return rules
	}
	if stored.AllowedMccs != nil {
		rules.AllowedMccs = *stored.AllowedMccs
	}
	if stored.ExpiresInDays != nil {
		rules.ExpiresInDays = *stored.ExpiresInDays
	}
	if stored.AmountCapCents != nil {
		rules.AmountCapCents = *stored.AmountCapCents
	}
	return rules
}
