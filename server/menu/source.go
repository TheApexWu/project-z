package menu

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type Item struct {
	ID          int64  `json:"id,omitempty"`
	Name        string `json:"name"`
	Description string `json:"description"`
	PriceCents  int    `json:"price_cents"`
	Category    string `json:"category"`
}

type Result struct {
	Restaurant string `json:"restaurant"`
	Items      []Item `json:"items"`
}

type MenuSource interface {
	Menu(context.Context, string) (Result, error)
}

type CsvSource struct {
	DatabaseURL string
}

func (s CsvSource) Menu(ctx context.Context, query string) (Result, error) {
	conn, err := pgx.Connect(ctx, s.DatabaseURL)
	if err != nil {
		return Result{}, fmt.Errorf("connect menu database: %w", err)
	}
	defer conn.Close(ctx)
	const normalized = "regexp_replace(lower(r.name), '[^a-z0-9]+', '', 'g')"
	var restaurant string
	err = conn.QueryRow(ctx, "WITH query AS (SELECT regexp_replace(lower($1), '[^a-z0-9]+', '', 'g') AS name) SELECT r.name FROM restaurants r CROSS JOIN query q WHERE "+normalized+" LIKE '%' || q.name || '%' OR q.name LIKE '%' || "+normalized+" || '%' ORDER BY CASE WHEN "+normalized+" = q.name THEN 0 WHEN "+normalized+" LIKE '%' || q.name || '%' THEN 1 ELSE 2 END, length(r.name) LIMIT 1", query).Scan(&restaurant)
	if err != nil {
		return Result{}, fmt.Errorf("find restaurant: %w", err)
	}
	rows, err := conn.Query(ctx, `SELECT mi.id, mi.name, mi.description, mi.price_cents, mi.category FROM menu_items mi JOIN restaurants r ON r.id = mi.restaurant_id WHERE r.name = $1 ORDER BY mi.category, mi.name`, restaurant)
	if err != nil {
		return Result{}, fmt.Errorf("query menu: %w", err)
	}
	defer rows.Close()
	result := Result{Restaurant: restaurant, Items: []Item{}}
	for rows.Next() {
		var item Item
		if err := rows.Scan(&item.ID, &item.Name, &item.Description, &item.PriceCents, &item.Category); err != nil {
			return Result{}, fmt.Errorf("read menu: %w", err)
		}
		result.Items = append(result.Items, item)
	}
	if err := rows.Err(); err != nil {
		return Result{}, fmt.Errorf("read menu: %w", err)
	}
	return result, nil
}

type BrowserUseSource struct {
	APIKey          string
	DeliveryAddress string
	DatabaseURL     string
	HTTPClient      *http.Client
}

func (s BrowserUseSource) Menu(ctx context.Context, restaurant string) (Result, error) {
	if s.APIKey == "" {
		return Result{}, fmt.Errorf("BROWSER_USER_API_KEY is not configured")
	}
	deliveryAddress, err := s.deliveryAddress(ctx)
	if err != nil {
		return Result{}, err
	}
	if strings.TrimSpace(deliveryAddress) == "" {
		return Result{}, fmt.Errorf("delivery address is not configured")
	}
	client := s.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	task := fmt.Sprintf("Open DoorDash using delivery address %q. Find the specific nearby location for restaurant %q, open its store page, and extract its currently orderable menu. Return ONLY valid JSON in this exact shape: {\"restaurant\":\"location name\",\"items\":[{\"name\":\"item\",\"description\":\"\",\"price_cents\":123,\"category\":\"\"}]}. Include only items with a visible price, convert dollars to integer cents, and return no markdown or prose.", deliveryAddress, restaurant)
	payload, err := json.Marshal(struct {
		Task            string `json:"task"`
		BrowserSettings struct {
			ProxyCountryCode string `json:"proxyCountryCode"`
		} `json:"browserSettings"`
	}{Task: task, BrowserSettings: struct {
		ProxyCountryCode string `json:"proxyCountryCode"`
	}{ProxyCountryCode: "us"}})
	if err != nil {
		return Result{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.browser-use.com/api/v4/runs", bytes.NewReader(payload))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Browser-Use-API-Key", s.APIKey)
	resp, err := client.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("create browser-use run: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return Result{}, fmt.Errorf("create browser-use run: %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var run struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&run); err != nil || run.ID == "" {
		return Result{}, fmt.Errorf("decode browser-use run: %w", err)
	}

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return Result{}, fmt.Errorf("browser-use run %s: %w", run.ID, ctx.Err())
		case <-ticker.C:
			result, done, err := s.getRun(ctx, client, run.ID)
			if err != nil {
				return Result{}, err
			}
			if done {
				if len(result.Items) == 0 {
					return Result{}, fmt.Errorf("browser-use run %s returned no menu items", run.ID)
				}
				return result, nil
			}
		}
	}
}

func (s BrowserUseSource) deliveryAddress(ctx context.Context) (string, error) {
	if strings.TrimSpace(s.DeliveryAddress) != "" {
		return s.DeliveryAddress, nil
	}
	if s.DatabaseURL == "" {
		return "", nil
	}
	conn, err := pgx.Connect(ctx, s.DatabaseURL)
	if err != nil {
		return "", fmt.Errorf("connect settings database: %w", err)
	}
	defer conn.Close(ctx)
	var address string
	if err := conn.QueryRow(ctx, "SELECT delivery_address FROM settings WHERE id = true").Scan(&address); err != nil {
		return "", fmt.Errorf("load delivery address: %w", err)
	}
	return address, nil
}

func (s BrowserUseSource) getRun(ctx context.Context, client *http.Client, runID string) (Result, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.browser-use.com/api/v4/runs/"+runID, nil)
	if err != nil {
		return Result{}, false, err
	}
	req.Header.Set("X-Browser-Use-API-Key", s.APIKey)
	resp, err := client.Do(req)
	if err != nil {
		return Result{}, false, fmt.Errorf("get browser-use run: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return Result{}, false, fmt.Errorf("get browser-use run: %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var run struct {
		Status string `json:"status"`
		Result string `json:"result"`
		Error  string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&run); err != nil {
		return Result{}, false, fmt.Errorf("decode browser-use run: %w", err)
	}
	switch strings.ToLower(run.Status) {
	case "completed":
		var result Result
		if err := json.Unmarshal([]byte(run.Result), &result); err != nil {
			return Result{}, false, fmt.Errorf("decode browser-use menu result: %w", err)
		}
		for _, item := range result.Items {
			if item.Name == "" || item.PriceCents < 0 {
				return Result{}, false, fmt.Errorf("browser-use returned invalid menu item")
			}
		}
		return result, true, nil
	case "failed", "cancelled", "stopped":
		return Result{}, false, fmt.Errorf("browser-use run %s: %s", runID, run.Error)
	default:
		return Result{}, false, nil
	}
}
