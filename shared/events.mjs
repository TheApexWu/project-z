// shared/events.mjs — THE SEAM.
//
// The backend emits these; the renderer theatricalizes them. Both halves are built in
// parallel against this file and nothing else. If you need a new visual beat, add an event
// here FIRST and get the other person to pull, or the two halves drift.
//
// Rules, non-negotiable because they have bitten every event-driven demo ever built:
//   - All money is INTEGER CENTS. No floats anywhere, ever.
//   - The renderer MUST ignore unknown event types rather than throw. The backend will emit
//     events the renderer does not know about yet; that must never blank the projector.
//   - Every event carries { type, orderId, ts }. ts is epoch millis.
//   - Events are append-only and ordered. The renderer may replay from index 0 at any time.

export const EVENTS = {
  // ---- lifecycle ----
  order_started: ["budgetTotal", "merchant", "expiresAt", "participants"],
  participant_joined: ["participant"],

  // ---- shopping ----
  item_added: ["participantId", "item"],
  item_removed: ["participantId", "sku"],
  budget_update: ["participantId", "spent", "remaining"],
  participant_locked: ["participantId", "released"],

  // ---- trading: the charming part, and the thing no other team will have ----
  budget_requested: ["participantId", "amount"],
  budget_traded: ["fromId", "toId", "amount"],
  budget_request_filled: ["participantId"],
  budget_request_expired: ["participantId", "shortfall"],

  // ---- timer ----
  timer_tick: ["remainingSec"],
  order_closing: [],

  // ---- the finale: REAL Rain data in the payload ----
  // card.limitAmount is what WE asked for. Rain stores 1.2x that as an allTime limit and does
  // not enforce it at authorization. Only card.mcc is enforced by Rain. The renderer prints
  // whatever it is given; honesty lives in the narration, not the sprite.
  card_issued: ["card"],              // { last4, limitAmount, mcc, expiresAt, cardId }
  checkout_submitted: ["merchant", "total"],
  auth_declined: ["reason", "mcc", "amount"],   // the guardrail beat: scoped_card_mcc_not_allowed
  auth_approved: ["authId", "amount"],
  auth_settled: ["amount"],

  // ---- scripted incident ----
  auth_reversed: ["amount", "reason", "participantId"],
  refund_issued: ["amount"],

  // ---- Rain-authoritative reconciliation: put THIS on screen when claiming money moved ----
  balances_updated: ["spendingPower", "pendingCharges", "postedCharges"],

  // ---- Monad settle-up -> danmaku ----
  settle_up_started: ["count"],
  settle_up_tx: ["participantId", "amount", "txHash", "confirmedMs"],
  settle_up_complete: ["totalMs"],
};

export function makeEvent(type, orderId, payload = {}) {
  const required = EVENTS[type];
  if (!required) throw new Error(`unknown event type: ${type}`);
  for (const k of required) {
    if (!(k in payload)) throw new Error(`event ${type} missing required field: ${k}`);
  }
  return { type, orderId, ts: Date.now(), ...payload };
}

export function isMoneyField(k) {
  return /^(amount|total|spent|remaining|released|budgetTotal|limitAmount|shortfall|spendingPower|pendingCharges|postedCharges)$/.test(k);
}

// Guard against the classic demo-killer: a float sneaking into a cents field.
export function assertCents(ev) {
  for (const [k, v] of Object.entries(ev)) {
    if (isMoneyField(k) && !Number.isInteger(v)) {
      throw new Error(`event ${ev.type}: ${k}=${v} must be integer cents`);
    }
  }
  return ev;
}

export const fmt = (cents) => `$${(cents / 100).toFixed(2)}`;

// A canned stream so the renderer can be built to completion before the backend exists.
// Run the show with ?demo=1 and it replays this at wall-clock-ish pacing.
export function cannedStream(orderId = "demo-order") {
  const P = [
    { id: "U1", name: "Carson", subBudget: 1000 },
    { id: "U2", name: "Alex", subBudget: 1000 },
    { id: "U3", name: "Dana", subBudget: 1000 },
  ];
  const e = (t, p) => makeEvent(t, orderId, p);
  return [
    e("order_started", { budgetTotal: 3000, merchant: "Moon Palace Burgers", expiresAt: Date.now() + 900000, participants: P }),
    e("item_added", { participantId: "U1", item: { sku: "fries-L", name: "Large Fries", price: 449 } }),
    e("budget_update", { participantId: "U1", spent: 449, remaining: 551 }),
    e("item_added", { participantId: "U2", item: { sku: "burger", name: "Moon Burger", price: 899 } }),
    e("budget_update", { participantId: "U2", spent: 899, remaining: 101 }),
    e("budget_requested", { participantId: "U2", amount: 240 }),
    e("budget_traded", { fromId: "U3", toId: "U2", amount: 240 }),
    e("budget_request_filled", { participantId: "U2" }),
    e("participant_locked", { participantId: "U1", released: 551 }),
    e("order_closing", {}),
    e("card_issued", { card: { last4: "7672", limitAmount: 1588, mcc: ["5814"], expiresAt: Date.now() + 900000, cardId: "demo-card" } }),
    e("auth_declined", { reason: "scoped_card_mcc_not_allowed", mcc: "5999", amount: 500 }),
    e("checkout_submitted", { merchant: "Moon Palace Burgers", total: 1588 }),
    e("auth_approved", { authId: "demo-auth", amount: 1588 }),
    e("auth_settled", { amount: 1588 }),
    e("balances_updated", { spendingPower: 529803, pendingCharges: 991096, postedCharges: 129101 }),
    e("auth_reversed", { amount: 449, reason: "large fries unavailable", participantId: "U1" }),
    e("refund_issued", { amount: 449 }),
    e("settle_up_started", { count: 3 }),
    e("settle_up_tx", { participantId: "U1", amount: 0, txHash: "0xdemo1", confirmedMs: 612 }),
    e("settle_up_tx", { participantId: "U2", amount: 1139, txHash: "0xdemo2", confirmedMs: 588 }),
    e("settle_up_tx", { participantId: "U3", amount: 0, txHash: "0xdemo3", confirmedMs: 640 }),
    e("settle_up_complete", { totalMs: 1840 }),
  ];
}
