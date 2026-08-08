import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAsha } from "../src/asha.mjs";

const P = { cap: 50, allowlist: ["0xCloudCompute", "0xDataAPI", "0xInference"], priceRef: 20, priceBand: 3, velocity: 3, windowMs: 1000 };

test("cap denies over-limit", () => {
  assert.deepEqual(makeAsha(P).check({ amount: 51, payTo: "0xCloudCompute" }, 0), { allow: false, reason: "cap" });
});

test("allowlist denies unknown payee — 0xAttacker can NEVER pass", () => {
  assert.equal(makeAsha(P).check({ amount: 5, payTo: "0xAttacker" }, 0).reason, "allowlist");
});

test("price-band denies (priceRef*band = 60; 61 > 60)", () => {
  const a = makeAsha({ ...P, cap: 100 });
  assert.equal(a.check({ amount: 61, payTo: "0xCloudCompute" }, 0).reason, "price-band");
});

test("velocity denies after N records in the window", () => {
  const a = makeAsha(P);
  const p = { amount: 5, payTo: "0xCloudCompute" };
  a.record(p, 0); a.record(p, 0); a.record(p, 0);
  assert.equal(a.check(p, 0).reason, "velocity");
});

test("LOAD-BEARING: injected $49.97 to an allowlisted-but-wrong merchant PASSES the gate", () => {
  // this is the whole point — a static gate can't tell it from a legit $49 buy
  assert.deepEqual(makeAsha(P).check({ amount: 49.97, payTo: "0xInference" }, 0), { allow: true, reason: "in-policy" });
});
