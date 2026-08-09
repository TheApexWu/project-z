package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maxOrderCents = 30000
	gracePeriod   = 2 * time.Minute

	stateOpen                  = "OPEN"
	stateCollecting            = "COLLECTING"
	stateGrace                 = "GRACE"
	stateMinting               = "MINTING"
	stateSubmitting            = "SUBMITTING"
	stateDeclinedProofCaptured = "DECLINED_PROOF_CAPTURED"
	stateClosed                = "CLOSED"
	stateCancelled             = "CANCELLED"
	stateFailed                = "FAILED"
)

var (
	ErrBudgetExceeded = errors.New("order budget exceeds $300")
	ErrCartOverBudget = errors.New("cart total exceeds participant share")
	ErrOrderLocked    = errors.New("order is no longer editable")
)

type clock func() time.Time

type orderEngine struct {
	db       *pgxpool.Pool
	now      clock
	notify   func(context.Context, string)
	agents   *agentSpawner
	rain     *rainClient
	doordash *doordashClient
}

func newOrderID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", bytes[:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:]), nil
}

func splitBudget(total, participants int) (int, error) {
	if total < 0 || total > maxOrderCents {
		return 0, ErrBudgetExceeded
	}
	if participants < 1 {
		return 0, errors.New("at least one participant is required")
	}
	return total / participants, nil
}

func cartWithinShare(currentTotal, itemPrice, quantity, share int) bool {
	return itemPrice >= 0 && quantity > 0 && currentTotal+itemPrice*quantity <= share
}

func graceDeadline(now time.Time) time.Time {
	return now.UTC().Add(gracePeriod)
}

func validTransition(from, to string) bool {
	return (from == stateOpen && (to == stateCollecting || to == stateCancelled)) ||
		(from == stateCollecting && (to == stateGrace || to == stateCancelled)) ||
		(from == stateGrace && (to == stateMinting || to == stateCancelled)) ||
		(from == stateMinting && (to == stateSubmitting || to == stateCancelled || to == stateFailed)) ||
		(from == stateSubmitting && to == stateDeclinedProofCaptured) ||
		(from == stateDeclinedProofCaptured && to == stateClosed)
}

func (e *orderEngine) create(ctx context.Context, budgetCents int, restaurant string, participants []string, timer time.Duration) (string, error) {
	share, err := splitBudget(budgetCents, len(participants))
	if err != nil {
		return "", err
	}
	if timer <= 0 {
		return "", errors.New("timer must be positive")
	}
	id, err := newOrderID()
	if err != nil {
		return "", err
	}
	now := e.now().UTC()
	tx, err := e.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO orders (id, state, budget_cents, timer_deadline, restaurant, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)`, id, stateOpen, budgetCents, now.Add(timer), restaurant, now); err != nil {
		return "", err
	}
	for _, participant := range participants {
		if participant == "" {
			return "", errors.New("participant id is required")
		}
		if _, err := tx.Exec(ctx, `INSERT INTO participants (order_id, slack_user_id, share_cents) VALUES ($1, $2, $3)`, id, participant, share); err != nil {
			return "", err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE orders SET state = $2, updated_at = $3 WHERE id = $1 AND state = $4`, id, stateCollecting, now, stateOpen); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}

func (e *orderEngine) transition(ctx context.Context, id, from, to string) error {
	if !validTransition(from, to) {
		return fmt.Errorf("invalid order transition %s -> %s", from, to)
	}
	command, err := e.db.Exec(ctx, `UPDATE orders SET state = $3, updated_at = $4 WHERE id = $1 AND state = $2`, id, from, to, e.now().UTC())
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return fmt.Errorf("order %s is not in %s", id, from)
	}
	e.changed(ctx, id)
	return nil
}

// tick reads persisted deadlines, so a replacement process resumes pending work.
func (e *orderEngine) tick(ctx context.Context) error {
	now := e.now().UTC()
	ids, err := e.expiringOrderIDs(ctx, now)
	if err != nil {
		return err
	}
	if _, err := e.db.Exec(ctx, `UPDATE orders SET state = $1, grace_deadline = $2, updated_at = $3 WHERE state = $4 AND timer_deadline <= $3`, stateGrace, graceDeadline(now), now, stateCollecting); err != nil {
		return err
	}
	if _, err := e.db.Exec(ctx, `UPDATE orders SET state = $1, updated_at = $2 WHERE state = $3 AND grace_deadline <= $2`, stateMinting, now, stateGrace); err != nil {
		return err
	}
	if err := e.mintOutstanding(ctx); err != nil {
		return err
	}
	if err := e.submitOutstanding(ctx); err != nil {
		return err
	}
	for _, id := range ids {
		e.changed(ctx, id)
	}
	return nil
}

// mintOutstanding claims every MINTING order that has no card attempt yet.
// The INSERT is the claim: it runs synchronously so the next tick cannot
// double-mint while the Rain call is in flight.
func (e *orderEngine) mintOutstanding(ctx context.Context) error {
	if e.rain == nil {
		return nil
	}
	rows, err := e.db.Query(ctx, `SELECT o.id, COALESCE(SUM(ci.price_cents * ci.quantity), 0)
		FROM orders o
		LEFT JOIN participants p ON p.order_id = o.id
		LEFT JOIN cart_items ci ON ci.participant_id = p.id
		WHERE o.state = $1 AND NOT EXISTS (SELECT 1 FROM card_attempts ca WHERE ca.order_id = o.id)
		GROUP BY o.id`, stateMinting)
	if err != nil {
		return err
	}
	type mintJob struct {
		orderID string
		total   int
	}
	var jobs []mintJob
	for rows.Next() {
		var job mintJob
		if err := rows.Scan(&job.orderID, &job.total); err != nil {
			rows.Close()
			return err
		}
		jobs = append(jobs, job)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, job := range jobs {
		if job.total <= 0 {
			// Nothing was ordered: there is no card to mint, so close as
			// CANCELLED rather than attempting a $0 Rain call and landing FAILED.
			if _, err := e.db.Exec(ctx, `UPDATE orders SET state = $2, updated_at = $3 WHERE id = $1 AND state = $4`, job.orderID, stateCancelled, e.now().UTC(), stateMinting); err != nil {
				return err
			}
			e.changed(ctx, job.orderID)
			continue
		}
		var attemptID int64
		if err := e.db.QueryRow(ctx, `INSERT INTO card_attempts (order_id, amount_cents) VALUES ($1, $2) RETURNING id`, job.orderID, job.total).Scan(&attemptID); err != nil {
			return err
		}
		go e.mintOrder(context.Background(), job.orderID, attemptID, job.total)
	}
	return nil
}

// mintOrder runs in a goroutine after the claim; it must tolerate cancel
// races (an admin may cancel a MINTING order while the Rain call is up).
func (e *orderEngine) mintOrder(ctx context.Context, orderID string, attemptID int64, totalCents int) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	fail := func(evidence map[string]any, err error) {
		if err != nil {
			evidence["error"] = err.Error()
		}
		if _, dbErr := e.db.Exec(ctx, `UPDATE card_attempts SET rain_response = $2 WHERE id = $1`, attemptID, evidence); dbErr != nil {
			fmt.Printf("record mint failure for order %s failed: %v\n", orderID, dbErr)
		}
		if _, dbErr := e.db.Exec(ctx, `UPDATE orders SET state = $2, updated_at = $3 WHERE id = $1 AND state = $4`, orderID, stateFailed, e.now().UTC(), stateMinting); dbErr != nil {
			fmt.Printf("mark order %s FAILED failed: %v\n", orderID, dbErr)
		}
		e.changed(ctx, orderID)
	}
	if totalCents > maxOrderCents {
		fail(map[string]any{"reason": "order total exceeds $300 cap at mint time", "total_cents": totalCents}, ErrBudgetExceeded)
		return
	}
	rules := loadRainRules(ctx, e.db)
	result, err := e.rain.createScopedCard(ctx, totalCents, rules, e.now())
	if _, dbErr := e.db.Exec(ctx, `UPDATE card_attempts SET rain_card_id = $2, rain_request = $3, rain_response = $4 WHERE id = $1`, attemptID, result.CardID, result.Request, result.Response); dbErr != nil {
		fmt.Printf("record mint evidence for order %s failed: %v\n", orderID, dbErr)
	}
	if err != nil {
		if _, dbErr := e.db.Exec(ctx, `UPDATE orders SET state = $2, updated_at = $3 WHERE id = $1 AND state = $4`, orderID, stateFailed, e.now().UTC(), stateMinting); dbErr != nil {
			fmt.Printf("mark order %s FAILED failed: %v\n", orderID, dbErr)
		}
		e.changed(ctx, orderID)
		return
	}
	if _, dbErr := e.db.Exec(ctx, `UPDATE orders SET collateral_contract_id = $2, collateral_chain = $3 WHERE id = $1`, orderID, e.rain.collateralContractID, e.rain.collateralChain); dbErr != nil {
		fmt.Printf("record collateral linkage for order %s failed: %v\n", orderID, dbErr)
	}
	if err := e.transition(ctx, orderID, stateMinting, stateSubmitting); err != nil {
		fmt.Printf("transition order %s MINTING -> SUBMITTING failed: %v\n", orderID, err)
	}
}

// submitOutstanding claims every SUBMITTING order whose latest card attempt
// has a minted card but no DoorDash submission yet. The UPDATE is the claim:
// it only succeeds while doordash_request is still empty.
func (e *orderEngine) submitOutstanding(ctx context.Context) error {
	if e.rain == nil || e.doordash == nil {
		return nil
	}
	rows, err := e.db.Query(ctx, `SELECT o.id, ca.id, ca.rain_card_id, ca.amount_cents
		FROM orders o
		JOIN LATERAL (SELECT id, rain_card_id, amount_cents, doordash_request FROM card_attempts WHERE order_id = o.id ORDER BY id DESC LIMIT 1) ca ON true
		WHERE o.state = $1 AND ca.rain_card_id <> '' AND ca.doordash_request = '{}'::jsonb`, stateSubmitting)
	if err != nil {
		return err
	}
	type submitJob struct {
		orderID   string
		attemptID int64
		cardID    string
		total     int
	}
	var jobs []submitJob
	for rows.Next() {
		var job submitJob
		if err := rows.Scan(&job.orderID, &job.attemptID, &job.cardID, &job.total); err != nil {
			rows.Close()
			return err
		}
		jobs = append(jobs, job)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, job := range jobs {
		claim := map[string]any{"claimed_at": e.now().UTC().Format(time.RFC3339)}
		command, err := e.db.Exec(ctx, `UPDATE card_attempts SET doordash_request = $2 WHERE id = $1 AND doordash_request = '{}'::jsonb`, job.attemptID, claim)
		if err != nil {
			return err
		}
		if command.RowsAffected() == 1 {
			go e.submitOrder(context.Background(), job.orderID, job.attemptID, job.cardID, job.total)
		}
	}
	return nil
}

// submitOrder runs in a goroutine after the claim: DoorDash Drive sandbox
// quote -> accept, then the intentional Rain decline as the payment leg.
func (e *orderEngine) submitOrder(ctx context.Context, orderID string, attemptID int64, cardID string, totalCents int) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	fail := func(stage string, err error) {
		if _, dbErr := e.db.Exec(ctx, `UPDATE card_attempts SET doordash_response = doordash_response || $2::jsonb WHERE id = $1`, attemptID, map[string]any{"error": stage + ": " + err.Error()}); dbErr != nil {
			fmt.Printf("record submit failure for order %s failed: %v\n", orderID, dbErr)
		}
		if _, dbErr := e.db.Exec(ctx, `UPDATE orders SET state = $2, updated_at = $3 WHERE id = $1 AND state = $4`, orderID, stateFailed, e.now().UTC(), stateSubmitting); dbErr != nil {
			fmt.Printf("mark order %s FAILED failed: %v\n", orderID, dbErr)
		}
		e.changed(ctx, orderID)
	}

	var restaurant string
	if err := e.db.QueryRow(ctx, `SELECT restaurant FROM orders WHERE id = $1`, orderID).Scan(&restaurant); err != nil {
		fail("load order", err)
		return
	}
	dropoff := "1 Hackathon Way, San Francisco, CA 94105"
	_ = e.db.QueryRow(ctx, `SELECT delivery_address FROM settings WHERE id = true AND delivery_address <> ''`).Scan(&dropoff)
	pickup := restaurantAddress(ctx, e.db, restaurant)
	if pickup == "" {
		pickup = doordashFallbackPickupAddress
	}
	items := []map[string]any{}
	itemRows, err := e.db.Query(ctx, `SELECT ci.name, SUM(ci.quantity), ci.price_cents
		FROM cart_items ci JOIN participants p ON p.id = ci.participant_id
		WHERE p.order_id = $1 GROUP BY ci.name, ci.price_cents ORDER BY ci.name`, orderID)
	if err != nil {
		fail("load cart items", err)
		return
	}
	defer itemRows.Close()
	for itemRows.Next() {
		var name string
		var quantity, price int
		if err := itemRows.Scan(&name, &quantity, &price); err != nil {
			fail("read cart items", err)
			return
		}
		items = append(items, map[string]any{"name": name, "quantity": quantity, "price": price})
	}

	deliveryID := "gg-" + orderID
	drive, err := e.doordash.submitDelivery(ctx, deliveryID, restaurant, pickup, dropoff, totalCents, items)
	drive.Response["payment_path"] = "rain_simulated_authorization"
	drive.Response["payment_note"] = "Drive sandbox cannot take a raw card payment; the DoorDash charge is simulated as a Rain authorization against the minted card, which declines by design (dummy card)."
	if _, dbErr := e.db.Exec(ctx, `UPDATE card_attempts SET doordash_request = $2, doordash_response = $3, doordash_delivery_id = $4 WHERE id = $1`, attemptID, drive.Request, drive.Response, drive.DeliveryID); dbErr != nil {
		fmt.Printf("record doordash evidence for order %s failed: %v\n", orderID, dbErr)
	}
	if err != nil {
		fail("doordash submit", err)
		return
	}

	payReq, payResp, err := e.rain.simulateAuthorization(ctx, cardID, totalCents, "DoorDash - "+restaurant)
	drive.Response["payment"] = map[string]any{"path": "rain_simulated_authorization", "request": payReq, "response": payResp}
	declinedAt := e.now().UTC()
	if _, dbErr := e.db.Exec(ctx, `UPDATE card_attempts SET doordash_response = $2, payment_path = $3, declined_at = $4 WHERE id = $1`, attemptID, drive.Response, "rain_simulated_authorization", declinedAt); dbErr != nil {
		fmt.Printf("record decline evidence for order %s failed: %v\n", orderID, dbErr)
	}
	if err != nil {
		fail("rain authorization", err)
		return
	}
	if err := e.transition(ctx, orderID, stateSubmitting, stateDeclinedProofCaptured); err != nil {
		fmt.Printf("transition order %s SUBMITTING -> DECLINED_PROOF_CAPTURED failed: %v\n", orderID, err)
		return
	}
	if err := e.transition(ctx, orderID, stateDeclinedProofCaptured, stateClosed); err != nil {
		fmt.Printf("transition order %s DECLINED_PROOF_CAPTURED -> CLOSED failed: %v\n", orderID, err)
	}
}

// restaurantAddress fuzzy-matches the order's restaurant name to the CSV
// restaurants table (same normalization as the menu endpoint).
func restaurantAddress(ctx context.Context, db *pgxpool.Pool, query string) string {
	const normalized = "regexp_replace(lower(r.name), '[^a-z0-9]+', '', 'g')"
	var address string
	err := db.QueryRow(ctx, "WITH query AS (SELECT regexp_replace(lower($1), '[^a-z0-9]+', '', 'g') AS name) SELECT r.address FROM restaurants r CROSS JOIN query q WHERE "+normalized+" LIKE '%' || q.name || '%' OR q.name LIKE '%' || "+normalized+" || '%' ORDER BY CASE WHEN "+normalized+" = q.name THEN 0 WHEN "+normalized+" LIKE '%' || q.name || '%' THEN 1 ELSE 2 END, length(r.name) LIMIT 1", query).Scan(&address)
	if err != nil {
		return ""
	}
	return address
}

func (e *orderEngine) expiringOrderIDs(ctx context.Context, now time.Time) ([]string, error) {
	rows, err := e.db.Query(ctx, `SELECT id FROM orders WHERE (state = $1 AND timer_deadline <= $3) OR (state = $2 AND grace_deadline <= $3)`, stateCollecting, stateGrace, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (e *orderEngine) changed(ctx context.Context, id string) {
	if e.notify != nil {
		go e.notify(context.Background(), id)
	}
}

func (e *orderEngine) startTicker(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			if err := e.tick(ctx); err != nil && !errors.Is(err, context.Canceled) {
				fmt.Printf("order deadline tick failed: %v\n", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (e *orderEngine) addCartItem(ctx context.Context, orderID, slackUserID string, menuItemID *int64, name string, priceCents, quantity int) error {
	if quantity < 1 || priceCents < 0 {
		return errors.New("price and quantity must be positive")
	}
	tx, err := e.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var participantID int64
	var share, cartTotal int
	var state string
	if err := tx.QueryRow(ctx, `SELECT p.id, p.share_cents, o.state
		FROM participants p JOIN orders o ON o.id = p.order_id
		WHERE p.order_id = $1 AND p.slack_user_id = $2 FOR UPDATE OF p, o`, orderID, slackUserID).Scan(&participantID, &share, &state); err != nil {
		return err
	}
	if err := tx.QueryRow(ctx, `SELECT COALESCE(SUM(price_cents * quantity), 0) FROM cart_items WHERE participant_id = $1`, participantID).Scan(&cartTotal); err != nil {
		return err
	}
	if state != stateCollecting && state != stateGrace {
		return ErrOrderLocked
	}
	if menuItemID != nil {
		if err := tx.QueryRow(ctx, `SELECT name, price_cents FROM menu_items WHERE id = $1`, *menuItemID).Scan(&name, &priceCents); err != nil {
			return err
		}
	}
	if !cartWithinShare(cartTotal, priceCents, quantity, share) {
		return ErrCartOverBudget
	}
	if _, err := tx.Exec(ctx, `INSERT INTO cart_items (participant_id, menu_item_id, name, price_cents, quantity) VALUES ($1, $2, $3, $4, $5)`, participantID, menuItemID, name, priceCents, quantity); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE participants SET confirmed_at = NULL WHERE id = $1`, participantID)
	if err != nil {
		return err
	}
	err = tx.Commit(ctx)
	if err == nil {
		e.changed(ctx, orderID)
	}
	return err
}

type cartItem struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	PriceCent int    `json:"price_cents"`
	Quantity  int    `json:"quantity"`
}

func (e *orderEngine) participantID(ctx context.Context, orderID, slackUserID string) (int64, error) {
	var id int64
	err := e.db.QueryRow(ctx, `SELECT id FROM participants WHERE order_id = $1 AND slack_user_id = $2`, orderID, slackUserID).Scan(&id)
	return id, err
}

func (e *orderEngine) getCart(ctx context.Context, orderID, slackUserID string) ([]cartItem, int, error) {
	participantID, err := e.participantID(ctx, orderID, slackUserID)
	if err != nil {
		return nil, 0, err
	}
	rows, err := e.db.Query(ctx, `SELECT id, name, price_cents, quantity FROM cart_items WHERE participant_id = $1 ORDER BY id`, participantID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := []cartItem{}
	total := 0
	for rows.Next() {
		var item cartItem
		if err := rows.Scan(&item.ID, &item.Name, &item.PriceCent, &item.Quantity); err != nil {
			return nil, 0, err
		}
		total += item.PriceCent * item.Quantity
		items = append(items, item)
	}
	return items, total, rows.Err()
}

func (e *orderEngine) removeCartItem(ctx context.Context, orderID, slackUserID, name string) error {
	tx, err := e.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var participantID int64
	var state string
	if err := tx.QueryRow(ctx, `SELECT p.id, o.state
		FROM participants p JOIN orders o ON o.id = p.order_id
		WHERE p.order_id = $1 AND p.slack_user_id = $2 FOR UPDATE OF p, o`, orderID, slackUserID).Scan(&participantID, &state); err != nil {
		return err
	}
	if state != stateCollecting && state != stateGrace {
		return ErrOrderLocked
	}
	command, err := tx.Exec(ctx, `DELETE FROM cart_items WHERE participant_id = $1 AND lower(name) = lower($2)`, participantID, name)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return errors.New("item not in cart")
	}
	if _, err := tx.Exec(ctx, `UPDATE participants SET confirmed_at = NULL WHERE id = $1`, participantID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	e.changed(ctx, orderID)
	return nil
}

func (e *orderEngine) confirm(ctx context.Context, orderID, slackUserID string) error {
	tx, err := e.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var state string
	if err := tx.QueryRow(ctx, `SELECT state FROM orders WHERE id = $1 FOR UPDATE`, orderID).Scan(&state); err != nil {
		return err
	}
	if state != stateCollecting && state != stateGrace {
		return ErrOrderLocked
	}
	command, err := tx.Exec(ctx, `UPDATE participants SET confirmed_at = $3 WHERE order_id = $1 AND slack_user_id = $2`, orderID, slackUserID, e.now().UTC())
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return errors.New("participant not found")
	}
	var allConfirmed bool
	if err := tx.QueryRow(ctx, `SELECT bool_and(confirmed_at IS NOT NULL) FROM participants WHERE order_id = $1`, orderID).Scan(&allConfirmed); err != nil {
		return err
	}
	if state == stateCollecting && allConfirmed {
		now := e.now().UTC()
		if _, err := tx.Exec(ctx, `UPDATE orders SET state = $2, grace_deadline = $3, updated_at = $4 WHERE id = $1`, orderID, stateGrace, graceDeadline(now), now); err != nil {
			return err
		}
	}
	err = tx.Commit(ctx)
	if err == nil {
		e.changed(ctx, orderID)
	}
	return err
}

func (e *orderEngine) unconfirm(ctx context.Context, orderID, slackUserID string) error {
	command, err := e.db.Exec(ctx, `UPDATE participants SET confirmed_at = NULL FROM orders o WHERE participants.order_id = o.id AND participants.order_id = $1 AND participants.slack_user_id = $2 AND o.state IN ($3, $4)`, orderID, slackUserID, stateCollecting, stateGrace)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrOrderLocked
	}
	e.changed(ctx, orderID)
	return nil
}

// forceEnd closes a live order immediately, skipping the 2-minute grace period.
// It routes through GRACE with an already-expired deadline so the 1s ticker moves
// the order to MINTING on the existing tested path; a direct COLLECTING->MINTING
// transition is not in the valid-transition table. This intentionally bypasses
// the PRD's always-apply-grace rule as an explicit product decision (admin-only
// Slack button).
func (e *orderEngine) forceEnd(ctx context.Context, orderID string) error {
	command, err := e.db.Exec(ctx, `UPDATE orders SET state = CASE WHEN state = $2 THEN $3 ELSE state END, grace_deadline = $4, updated_at = $4 WHERE id = $1 AND state IN ($2, $3)`, orderID, stateCollecting, stateGrace, e.now().UTC())
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return errors.New("order cannot be force-ended")
	}
	e.changed(ctx, orderID)
	return nil
}

func (e *orderEngine) cancel(ctx context.Context, orderID string) error {
	command, err := e.db.Exec(ctx, `UPDATE orders SET state = $2, updated_at = $3 WHERE id = $1 AND state IN ($4, $5, $6, $7)`, orderID, stateCancelled, e.now().UTC(), stateOpen, stateCollecting, stateGrace, stateMinting)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return errors.New("order cannot be cancelled")
	}
	e.changed(ctx, orderID)
	return nil
}
