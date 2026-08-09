package main

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
)

// wsHub pushes full order snapshots to every /ws subscriber of an order.
// orderEngine.changed -> hub.broadcast is the only trigger; no per-event diffing.
type wsHub struct {
	db   *pgxpool.Pool
	mu   sync.Mutex
	subs map[string]map[*wsClient]struct{}
}

type wsClient struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

func newWSHub(db *pgxpool.Pool) *wsHub {
	return &wsHub{db: db, subs: map[string]map[*wsClient]struct{}{}}
}

func (h *wsHub) handler(w http.ResponseWriter, r *http.Request) {
	orderID := r.URL.Query().Get("order_id")
	if orderID == "" {
		http.Error(w, "order_id is required", http.StatusBadRequest)
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
	if err != nil {
		return
	}
	client := &wsClient{conn: conn}
	h.mu.Lock()
	if h.subs[orderID] == nil {
		h.subs[orderID] = map[*wsClient]struct{}{}
	}
	h.subs[orderID][client] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.subs[orderID], client)
		if len(h.subs[orderID]) == 0 {
			delete(h.subs, orderID)
		}
		h.mu.Unlock()
		conn.Close(websocket.StatusNormalClosure, "bye")
	}()
	if snapshot, err := orderSnapshot(r.Context(), h.db, orderID); err == nil {
		client.write(snapshot)
	}
	// CloseRead discards client frames and cancels when the peer goes away.
	<-conn.CloseRead(r.Context()).Done()
}

func (h *wsHub) broadcast(orderID string) {
	h.mu.Lock()
	var clients []*wsClient
	for client := range h.subs[orderID] {
		clients = append(clients, client)
	}
	h.mu.Unlock()
	if len(clients) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	snapshot, err := orderSnapshot(ctx, h.db, orderID)
	cancel()
	if err != nil {
		return
	}
	for _, client := range clients {
		go client.write(snapshot)
	}
}

func (c *wsClient) write(payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = c.conn.Write(ctx, websocket.MessageText, data)
}

// orderSnapshot is the live-page view model; also served as GET /api/orders/{id}.
func orderSnapshot(ctx context.Context, db *pgxpool.Pool, orderID string) (map[string]any, error) {
	var state, restaurant string
	var budget int
	var timerDeadline, graceDeadline *time.Time
	var createdAt, updatedAt time.Time
	err := db.QueryRow(ctx, `SELECT state, restaurant, budget_cents, timer_deadline, grace_deadline, created_at, updated_at FROM orders WHERE id = $1`, orderID).
		Scan(&state, &restaurant, &budget, &timerDeadline, &graceDeadline, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	snapshot := map[string]any{
		"id":             orderID,
		"state":          state,
		"restaurant":     restaurant,
		"budget_cents":   budget,
		"timer_deadline": timerDeadline,
		"grace_deadline": graceDeadline,
		"created_at":     createdAt,
		"updated_at":     updatedAt,
		"server_time":    time.Now().UTC(),
	}
	rows, err := db.Query(ctx, `SELECT p.slack_user_id, p.share_cents, p.confirmed_at IS NOT NULL, COALESCE(json_agg(json_build_object('name', ci.name, 'price_cents', ci.price_cents, 'quantity', ci.quantity) ORDER BY ci.id) FILTER (WHERE ci.id IS NOT NULL), '[]'::json)
		FROM participants p LEFT JOIN cart_items ci ON ci.participant_id = p.id
		WHERE p.order_id = $1 GROUP BY p.id ORDER BY p.id`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	participants := []map[string]any{}
	total := 0
	for rows.Next() {
		var userID string
		var share int
		var confirmed bool
		var cart json.RawMessage
		if err := rows.Scan(&userID, &share, &confirmed, &cart); err != nil {
			return nil, err
		}
		cartTotal := 0
		var items []struct {
			PriceCents int `json:"price_cents"`
			Quantity   int `json:"quantity"`
		}
		if json.Unmarshal(cart, &items) == nil {
			for _, item := range items {
				cartTotal += item.PriceCents * item.Quantity
			}
		}
		total += cartTotal
		participants = append(participants, map[string]any{
			"slack_user_id":   userID,
			"share_cents":     share,
			"confirmed":       confirmed,
			"cart":            cart,
			"cart_total_cents": cartTotal,
		})
	}
	snapshot["participants"] = participants
	snapshot["total_cents"] = total
	return snapshot, rows.Err()
}
