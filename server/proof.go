package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// GET /api/orders/{id}/proof — the decline-proof showcase: full Rain minting
// and DoorDash submission evidence for one order. Unauthenticated by design;
// card PAN/CVC inside rain_response is session-encrypted.
func orderProofHandler(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/orders/"), "/")
		if r.Method != http.MethodGet || len(parts) == 0 || parts[0] == "" {
			http.NotFound(w, r)
			return
		}
		orderID := parts[0]
		// GET /api/orders/{id} — live snapshot (same payload the websocket pushes).
		if len(parts) == 1 {
			snapshot, err := orderSnapshot(r.Context(), db, orderID)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(snapshot)
			return
		}
		if len(parts) != 2 || parts[1] != "proof" {
			http.NotFound(w, r)
			return
		}
		var state, restaurant, contractID, chain string
		var budget int
		var createdAt, updatedAt time.Time
		if err := db.QueryRow(r.Context(), `SELECT state, restaurant, budget_cents, collateral_contract_id, collateral_chain, created_at, updated_at FROM orders WHERE id = $1`, orderID).Scan(&state, &restaurant, &budget, &contractID, &chain, &createdAt, &updatedAt); err != nil {
			http.NotFound(w, r)
			return
		}
		proof := map[string]any{
			"order_id":               orderID,
			"state":                  state,
			"restaurant":             restaurant,
			"budget_cents":           budget,
			"collateral_contract_id": contractID,
			"collateral_chain":       chain,
			"created_at":             createdAt,
			"updated_at":             updatedAt,
		}
		var attempt struct {
			id            int64
			cardID        string
			amountCents   int
			rainRequest   json.RawMessage
			rainResponse  json.RawMessage
			ddRequest     json.RawMessage
			ddResponse    json.RawMessage
			deliveryID    string
			paymentPath   string
			declinedAt    *time.Time
			attemptCreate time.Time
		}
		err := db.QueryRow(r.Context(), `SELECT id, rain_card_id, amount_cents, rain_request, rain_response, doordash_request, doordash_response, doordash_delivery_id, payment_path, declined_at, created_at
			FROM card_attempts WHERE order_id = $1 ORDER BY id DESC LIMIT 1`, orderID).
			Scan(&attempt.id, &attempt.cardID, &attempt.amountCents, &attempt.rainRequest, &attempt.rainResponse, &attempt.ddRequest, &attempt.ddResponse, &attempt.deliveryID, &attempt.paymentPath, &attempt.declinedAt, &attempt.attemptCreate)
		if err == nil {
			proof["card_attempt"] = map[string]any{
				"id":                    attempt.id,
				"rain_card_id":          attempt.cardID,
				"amount_cents":          attempt.amountCents,
				"rain_request":          attempt.rainRequest,
				"rain_response":         attempt.rainResponse,
				"doordash_request":      attempt.ddRequest,
				"doordash_response":     attempt.ddResponse,
				"doordash_delivery_id":  attempt.deliveryID,
				"payment_path":          attempt.paymentPath,
				"declined_at":           attempt.declinedAt,
				"created_at":            attempt.attemptCreate,
			}
		}
		rows, err := db.Query(r.Context(), `SELECT p.slack_user_id, p.share_cents, p.confirmed_at IS NOT NULL, COALESCE(json_agg(json_build_object('name', ci.name, 'price_cents', ci.price_cents, 'quantity', ci.quantity)) FILTER (WHERE ci.id IS NOT NULL), '[]'::json)
			FROM participants p LEFT JOIN cart_items ci ON ci.participant_id = p.id
			WHERE p.order_id = $1 GROUP BY p.id ORDER BY p.id`, orderID)
		if err == nil {
			defer rows.Close()
			participants := []map[string]any{}
			total := 0
			for rows.Next() {
				var userID string
				var share int
				var confirmed bool
				var cart json.RawMessage
				if err := rows.Scan(&userID, &share, &confirmed, &cart); err == nil {
					var items []struct {
						PriceCents int `json:"price_cents"`
						Quantity   int `json:"quantity"`
					}
					if json.Unmarshal(cart, &items) == nil {
						for _, item := range items {
							total += item.PriceCents * item.Quantity
						}
					}
					participants = append(participants, map[string]any{"slack_user_id": userID, "share_cents": share, "confirmed": confirmed, "cart": cart})
				}
			}
			proof["participants"] = participants
			proof["total_cents"] = total
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(proof)
	}
}
