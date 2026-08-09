package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// GET /api/orders — every order with rollups for the past-orders page.
func orderListHandler(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		rows, err := db.Query(r.Context(), `SELECT o.id, o.state, o.restaurant, o.budget_cents, o.created_at, o.updated_at,
			COALESCE((SELECT SUM(ci.price_cents * ci.quantity) FROM participants p JOIN cart_items ci ON ci.participant_id = p.id WHERE p.order_id = o.id), 0),
			(SELECT COUNT(*) FROM participants p WHERE p.order_id = o.id),
			(SELECT COUNT(*) FROM participants p WHERE p.order_id = o.id AND p.confirmed_at IS NOT NULL),
			COALESCE((SELECT ca.rain_card_id FROM card_attempts ca WHERE ca.order_id = o.id ORDER BY ca.id DESC LIMIT 1), ''),
			(SELECT ca.declined_at FROM card_attempts ca WHERE ca.order_id = o.id ORDER BY ca.id DESC LIMIT 1)
			FROM orders o ORDER BY o.created_at DESC`, )
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		orders := []map[string]any{}
		for rows.Next() {
			var id, state, restaurant, cardID string
			var budget, total, participantCount, confirmedCount int
			var createdAt, updatedAt time.Time
			var declinedAt *time.Time
			if err := rows.Scan(&id, &state, &restaurant, &budget, &createdAt, &updatedAt, &total, &participantCount, &confirmedCount, &cardID, &declinedAt); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			orders = append(orders, map[string]any{
				"id":                id,
				"state":             state,
				"restaurant":        restaurant,
				"budget_cents":      budget,
				"total_cents":       total,
				"participant_count": participantCount,
				"confirmed_count":   confirmedCount,
				"rain_card_id":      cardID,
				"declined_at":       declinedAt,
				"created_at":        createdAt,
				"updated_at":        updatedAt,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"orders": orders})
	}
}

// /api/admins[/{slack_user_id}] — manage who may create orders. Admin-auth only.
func adminsHandler(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r) {
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/api/admins")
		id = strings.TrimPrefix(id, "/")
		switch {
		case id == "" && r.Method == http.MethodGet:
			rows, err := db.Query(r.Context(), `SELECT slack_user_id, can_create_orders, created_at FROM admins ORDER BY created_at`)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			defer rows.Close()
			admins := []map[string]any{}
			for rows.Next() {
				var userID string
				var canCreate bool
				var createdAt time.Time
				if err := rows.Scan(&userID, &canCreate, &createdAt); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				admins = append(admins, map[string]any{"slack_user_id": userID, "can_create_orders": canCreate, "created_at": createdAt})
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"admins": admins})
		case id == "" && r.Method == http.MethodPost:
			var input struct {
				SlackUserID     string `json:"slack_user_id"`
				CanCreateOrders bool   `json:"can_create_orders"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.SlackUserID == "" {
				http.Error(w, "slack_user_id is required", http.StatusBadRequest)
				return
			}
			if _, err := db.Exec(r.Context(), `INSERT INTO admins (slack_user_id, can_create_orders) VALUES ($1, $2)
				ON CONFLICT (slack_user_id) DO UPDATE SET can_create_orders = $2, updated_at = now()`, input.SlackUserID, input.CanCreateOrders); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case id != "" && r.Method == http.MethodDelete:
			if _, err := db.Exec(r.Context(), `DELETE FROM admins WHERE slack_user_id = $1`, id); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

// GET /api/slack/users — workspace users for the admin picker (proxied so the
// bot token never reaches the browser). Org-level token: users.list needs
// team_id as a query param (JSON body is ignored for it).
func slackUsersHandler(client slackClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r) {
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var result struct {
			Members []struct {
				ID       string `json:"id"`
				Name     string `json:"name"`
				RealName string `json:"real_name"`
				Deleted  bool   `json:"deleted"`
				IsBot    bool   `json:"is_bot"`
			} `json:"members"`
		}
		if err := client.get(r.Context(), "users.list?team_id=T0BP3FGUGCU&limit=200", &result); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		users := []map[string]string{}
		for _, member := range result.Members {
			if member.Deleted || member.IsBot {
				continue
			}
			users = append(users, map[string]string{"id": member.ID, "name": member.Name, "real_name": member.RealName})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"users": users})
	}
}
