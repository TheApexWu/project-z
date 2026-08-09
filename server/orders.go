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
)

var (
	ErrBudgetExceeded = errors.New("order budget exceeds $300")
	ErrCartOverBudget = errors.New("cart total exceeds participant share")
	ErrOrderLocked    = errors.New("order is no longer editable")
)

type clock func() time.Time

type orderEngine struct {
	db     *pgxpool.Pool
	now    clock
	notify func(context.Context, string)
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
		(from == stateMinting && (to == stateSubmitting || to == stateCancelled)) ||
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
	for _, id := range ids {
		e.changed(ctx, id)
	}
	return nil
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
