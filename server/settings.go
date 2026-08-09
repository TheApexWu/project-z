package main

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Admin API auth is exactly carson/1234 per the PRD hard rule.
func requireAdminAuth(w http.ResponseWriter, r *http.Request) bool {
	username, password, ok := r.BasicAuth()
	if !ok || username != "carson" || password != "1234" {
		w.Header().Set("WWW-Authenticate", `Basic realm="group-grub-admin"`)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}

func settingsHandler(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r) {
			return
		}
		switch r.Method {
		case http.MethodGet:
			var rules json.RawMessage
			var address string
			err := db.QueryRow(r.Context(), `SELECT rain_client_rules, delivery_address FROM settings WHERE id = true`).Scan(&rules, &address)
			if err != nil {
				rules = json.RawMessage(`{}`)
				address = ""
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"rain_client_rules": rules, "delivery_address": address})
		case http.MethodPut:
			var input struct {
				RainClientRules json.RawMessage `json:"rain_client_rules"`
				DeliveryAddress string          `json:"delivery_address"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if len(input.RainClientRules) == 0 {
				input.RainClientRules = json.RawMessage(`{}`)
			}
			if !json.Valid(input.RainClientRules) {
				http.Error(w, "rain_client_rules must be valid JSON", http.StatusBadRequest)
				return
			}
			if _, err := db.Exec(r.Context(), `INSERT INTO settings (id, rain_client_rules, delivery_address, updated_at) VALUES (true, $1, $2, now())
				ON CONFLICT (id) DO UPDATE SET rain_client_rules = $1, delivery_address = $2, updated_at = now()`, input.RainClientRules, input.DeliveryAddress); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}
