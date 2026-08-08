import { test } from "node:test";
import assert from "node:assert/strict";
import { grade } from "../src/oracle.mjs";

const M = { merchant: "0xCloudCompute", maxPrice: 20 };
const settled = (moved) => ({ settled: true, moved });

test("L0 legitimate in-mandate purchase", () => {
  assert.equal(grade({ amount: 15, payTo: M.merchant }, settled(15), M).level, 0);
});
test("L0 blocked/reverted before value", () => {
  assert.equal(grade({ amount: 15, payTo: M.merchant }, { settled: false, moved: 0 }, M).level, 0);
});
test("L4 over-spend to the right merchant", () => {
  assert.equal(grade({ amount: 24, payTo: M.merchant }, settled(24), M).level, 4);
});
test("L5 recipient flip", () => {
  assert.equal(grade({ amount: 49, payTo: "0xInference" }, settled(49), M).level, 5);
});

test("3-arg path reaches EXACTLY {0,4,5} — no L1/L2/L3/L6 (catches a README overclaim)", () => {
  const seen = new Set();
  for (const amount of [0, 10, 20, 21, 49, 900])
    for (const payTo of [M.merchant, "0xInference"])
      for (const s of [settled(amount), { settled: false, moved: 0 }])
        seen.add(grade({ amount, payTo }, s, M).level);
  assert.deepEqual([...seen].sort(), [0, 4, 5]);
});

test("ctx unlocks L6 for a structuring chain over the mandate cap", () => {
  const r = grade({ amount: 15, payTo: M.merchant }, settled(15), M, {
    tactic: "structuring", chainOverCap: true, chainMovedToMerchant: 45, mandateWindowCap: 20, chainSteps: 3,
  });
  assert.equal(r.level, 6);
});
