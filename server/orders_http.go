package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

func orderHandler(engine *orderEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/internal/orders/"), "/")
		if len(parts) == 2 && parts[1] == "cancel" && r.Method == http.MethodPost {
			if err := engine.cancel(r.Context(), parts[0]); err != nil {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if len(parts) == 1 && parts[0] != "" && r.Method == http.MethodGet {
			var state string
			if err := engine.db.QueryRow(r.Context(), `SELECT state FROM orders WHERE id = $1`, parts[0]).Scan(&state); err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"id": parts[0], "state": state})
			return
		}
		if len(parts) == 1 && parts[0] == "" && r.Method == http.MethodPost {
			var input struct {
				BudgetCents  int      `json:"budget_cents"`
				Restaurant   string   `json:"restaurant"`
				Participants []string `json:"participants"`
				TimerSeconds int      `json:"timer_seconds"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			id, err := engine.create(r.Context(), input.BudgetCents, input.Restaurant, input.Participants, time.Duration(input.TimerSeconds)*time.Second)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"id": id})
			return
		}
		if len(parts) != 4 || parts[1] != "participants" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		orderID, slackUserID, action := parts[0], parts[2], parts[3]
		var err error
		switch action {
		case "confirm":
			err = engine.confirm(r.Context(), orderID, slackUserID)
		case "unconfirm":
			err = engine.unconfirm(r.Context(), orderID, slackUserID)
		case "cart":
			var item struct {
				MenuItemID *int64 `json:"menu_item_id"`
				Name       string `json:"name"`
				PriceCents int    `json:"price_cents"`
				Quantity   int    `json:"quantity"`
			}
			if err = json.NewDecoder(r.Body).Decode(&item); err == nil {
				err = engine.addCartItem(r.Context(), orderID, slackUserID, item.MenuItemID, item.Name, item.PriceCents, item.Quantity)
			}
		default:
			http.NotFound(w, r)
			return
		}
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, ErrOrderLocked) {
				status = http.StatusConflict
			}
			http.Error(w, err.Error(), status)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
