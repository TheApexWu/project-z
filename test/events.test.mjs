import test from "node:test";
import assert from "node:assert/strict";
import { makeEvent, assertCents, cannedStream, EVENTS, fmt } from "../shared/events.mjs";

test("makeEvent stamps type, orderId and ts", () => {
  const e = makeEvent("order_closing", "o1");
  assert.equal(e.type, "order_closing");
  assert.equal(e.orderId, "o1");
  assert.ok(Number.isInteger(e.ts) && e.ts > 0);
});

test("makeEvent rejects an unknown type", () => {
  assert.throws(() => makeEvent("not_a_real_event", "o1"), /unknown event type/);
});

test("makeEvent rejects a missing required field", () => {
  // budget_traded needs fromId, toId, amount — omit amount
  assert.throws(() => makeEvent("budget_traded", "o1", { fromId: "U1", toId: "U2" }), /missing required field: amount/);
});

test("assertCents rejects a float in a money field", () => {
  const e = makeEvent("budget_traded", "o1", { fromId: "U1", toId: "U2", amount: 1.48 });
  assert.throws(() => assertCents(e), /must be integer cents/);
});

test("assertCents passes integer cents", () => {
  const e = makeEvent("budget_traded", "o1", { fromId: "U1", toId: "U2", amount: 148 });
  assert.equal(assertCents(e).amount, 148);
});

test("every event in the canned stream is well-formed and integer-cents", () => {
  const s = cannedStream("o1");
  assert.ok(s.length >= 15, "canned stream must cover the whole show");
  for (const e of s) {
    assert.ok(EVENTS[e.type], `canned stream emits unknown type ${e.type}`);
    assertCents(e);
  }
});

test("canned stream contains every beat the renderer must handle", () => {
  const types = new Set(cannedStream("o1").map((e) => e.type));
  for (const need of ["order_started", "budget_traded", "card_issued", "auth_declined", "auth_reversed", "settle_up_tx"]) {
    assert.ok(types.has(need), `canned stream is missing the ${need} beat`);
  }
});

test("fmt renders cents as dollars without float drift", () => {
  assert.equal(fmt(2596), "$25.96");
  assert.equal(fmt(0), "$0.00");
  assert.equal(fmt(1), "$0.01");
});
