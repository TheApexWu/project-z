package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Near-dropoff pickup used when the restaurant's CSV address is outside
// DoorDash's serviceable distance (sandbox enforces real distance rules).
const doordashFallbackPickupAddress = "901 Market Street 6th Floor San Francisco, CA 94103"

type doordashClient struct {
	developerID string
	keyID       string
	secret      []byte
	http        *http.Client
}

type driveAttempt struct {
	At     time.Time       `json:"at"`
	Status int             `json:"status,omitempty"`
	Body   json.RawMessage `json:"body,omitempty"`
	Error  string          `json:"error,omitempty"`
}

type driveResult struct {
	DeliveryID  string
	TrackingURL string
	Request     map[string]any
	Response    map[string]any
}

func doordashClientFromEnv() (*doordashClient, error) {
	developerID := os.Getenv("DOORDASH_DEVELOPER_ID")
	keyID := os.Getenv("DOORDASH_KEY_ID")
	signingSecret := os.Getenv("DOORDASH_SIGNING_SECRET")
	if developerID == "" || keyID == "" || signingSecret == "" {
		return nil, errors.New("DOORDASH_DEVELOPER_ID, DOORDASH_KEY_ID and DOORDASH_SIGNING_SECRET are required")
	}
	secret, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(signingSecret, "="))
	if err != nil {
		return nil, fmt.Errorf("decode DOORDASH_SIGNING_SECRET: %w", err)
	}
	return &doordashClient{developerID: developerID, keyID: keyID, secret: secret, http: &http.Client{Timeout: 15 * time.Second}}, nil
}

// jwt mints a DD-JWT-V1 token (HS256, 5-minute expiry) per Drive docs.
func (c *doordashClient) jwt(now time.Time) (string, error) {
	header, err := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT", "dd-ver": "DD-JWT-V1"})
	if err != nil {
		return "", err
	}
	claims, err := json.Marshal(map[string]any{
		"aud": "doordash",
		"iss": c.developerID,
		"kid": c.keyID,
		"iat": now.Unix(),
		"exp": now.Add(5 * time.Minute).Unix(),
	})
	if err != nil {
		return "", err
	}
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	mac := hmac.New(sha256.New, c.secret)
	if _, err := mac.Write([]byte(unsigned)); err != nil {
		return "", err
	}
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

type driveAPIError struct {
	status int
	body   string
}

func (e *driveAPIError) Error() string {
	return fmt.Sprintf("doordash API status %d: %s", e.status, e.body)
}

func isDistanceError(err error) bool {
	var apiErr *driveAPIError
	return errors.As(err, &apiErr) && apiErr.status == http.StatusUnprocessableEntity && strings.Contains(apiErr.body, "distance_too_long")
}

func (c *doordashClient) call(ctx context.Context, url string, body any, attempts *[]driveAttempt) (json.RawMessage, error) {
	attempt := driveAttempt{At: time.Now().UTC()}
	*attempts = append(*attempts, attempt)
	record := func(status int, responseBody []byte, err error) {
		attempt.Status = status
		if json.Valid(responseBody) {
			attempt.Body = json.RawMessage(responseBody)
		} else if len(responseBody) > 0 {
			attempt.Body, _ = json.Marshal(string(responseBody))
		}
		if err != nil {
			attempt.Error = err.Error()
		}
		(*attempts)[len(*attempts)-1] = attempt
	}
	token, err := c.jwt(time.Now().UTC())
	if err != nil {
		record(0, nil, err)
		return nil, err
	}
	payload, err := json.Marshal(body)
	if err != nil {
		record(0, nil, err)
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		record(0, nil, err)
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		record(0, nil, err)
		return nil, err
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		record(resp.StatusCode, nil, err)
		return nil, err
	}
	record(resp.StatusCode, responseBody, nil)
	if resp.StatusCode/100 != 2 {
		return nil, &driveAPIError{status: resp.StatusCode, body: string(responseBody)}
	}
	return json.RawMessage(responseBody), nil
}

// submitDelivery runs quote -> accept in the Drive sandbox. The restaurant's
// CSV address is tried first; a distance_too_long rejection retries once with
// the near-dropoff fallback pickup. Network/5xx failures retry once.
func (c *doordashClient) submitDelivery(ctx context.Context, deliveryID, restaurant, pickupAddress, dropoffAddress string, totalCents int, items []map[string]any) (driveResult, error) {
	result := driveResult{
		DeliveryID: deliveryID,
		Request:    map[string]any{},
		Response:   map[string]any{"quote_attempts": []driveAttempt{}, "accept_attempts": []driveAttempt{}},
	}
	quoteBody := map[string]any{
		"external_delivery_id":  deliveryID,
		"pickup_address":        pickupAddress,
		"pickup_business_name":  restaurant,
		"pickup_phone_number":   "+16505555555",
		"dropoff_address":       dropoffAddress,
		"dropoff_phone_number":  "+16505555555",
		"dropoff_instructions":  "Group Grub sandbox order",
		"order_value":           totalCents,
		"items":                 items,
		"contactless_dropoff":   true,
		"action_if_undeliverable": "dispose",
	}
	result.Request["quote"] = map[string]any{"method": http.MethodPost, "url": "https://openapi.doordash.com/drive/v2/quotes", "body": quoteBody}

	quoteAttempts := []driveAttempt{}
	var lastErr error
	accepted := false
	for try := 0; try < 2 && !accepted; try++ {
		_, lastErr = c.call(ctx, "https://openapi.doordash.com/drive/v2/quotes", quoteBody, &quoteAttempts)
		result.Response["quote_attempts"] = quoteAttempts
		if lastErr == nil {
			accepted = true
			break
		}
		if isDistanceError(lastErr) && quoteBody["pickup_address"] != doordashFallbackPickupAddress {
			quoteBody["pickup_address"] = doordashFallbackPickupAddress
			result.Request["quote"] = map[string]any{"method": http.MethodPost, "url": "https://openapi.doordash.com/drive/v2/quotes", "body": quoteBody, "note": "retried with fallback pickup after distance_too_long"}
			try-- // the fallback retry is not a failure retry
			continue
		}
		var apiErr *driveAPIError
		if errors.As(lastErr, &apiErr) && apiErr.status < 500 {
			break
		}
	}
	if !accepted {
		return result, lastErr
	}

	acceptBody := map[string]any{"order_value": totalCents}
	acceptURL := "https://openapi.doordash.com/drive/v2/quotes/" + deliveryID + "/accept"
	result.Request["accept"] = map[string]any{"method": http.MethodPost, "url": acceptURL, "body": acceptBody}
	acceptAttempts := []driveAttempt{}
	for try := 0; try < 2; try++ {
		body, err := c.call(ctx, acceptURL, acceptBody, &acceptAttempts)
		result.Response["accept_attempts"] = acceptAttempts
		if err == nil {
			var delivery struct {
				DeliveryStatus string `json:"delivery_status"`
				TrackingURL    string `json:"tracking_url"`
			}
			if json.Unmarshal(body, &delivery) == nil {
				result.Response["delivery_status"] = delivery.DeliveryStatus
				result.TrackingURL = delivery.TrackingURL
				result.Response["tracking_url"] = delivery.TrackingURL
			}
			return result, nil
		}
		lastErr = err
		var apiErr *driveAPIError
		if errors.As(err, &apiErr) && apiErr.status < 500 {
			break
		}
	}
	return result, lastErr
}
