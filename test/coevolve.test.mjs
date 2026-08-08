import { test } from "node:test";
import assert from "node:assert/strict";
import { coevolve } from "../src/coevolve.mjs";

const policy = { cap: 50, allowlist: ["0xCloudCompute", "0xDataAPI", "0xInference"], priceRef: 20, priceBand: 3, velocity: 100, windowMs: 1000 };
const mandate = { merchant: "0xCloudCompute", maxPrice: 20 };
const candidates = [...policy.allowlist, "0xAttacker"];

test("the attacker's take falls as the cap tightens (the arms race)", async () => {
  const { history } = await coevolve({ policy, mandate, candidates, seed: 7 });
  const found = history.map((h) => h.attackerFound);
  assert.ok(found.length >= 3, "should run several rounds");
  assert.ok(found[0] > found.at(-1), `should fall: ${found[0]} -> ${found.at(-1)}`);
  for (let i = 1; i < found.length; i++)
    assert.ok(found[i] <= found[i - 1] + 0.01, `round ${i} not <= round ${i - 1}: ${found[i]} vs ${found[i - 1]}`);
});

test("convergence is a NON-ZERO floor near the legit ceiling (residual recipient-flip)", async () => {
  const { floor, legitCeiling } = await coevolve({ policy, mandate, candidates, seed: 7 });
  assert.ok(floor > 0, `floor must be > 0, got ${floor}`);
  assert.ok(floor <= legitCeiling + 0.5, `floor ${floor} should be <= legit ceiling ${legitCeiling} — can't tighten below without blocking legit buys`);
  assert.ok(floor > legitCeiling * 0.5, `floor ${floor} should be near the ceiling, not ~0 (the whole point: it's structurally unreachable)`);
});

test("sealed-$ rises as attacker-$ falls (mirror curves)", async () => {
  const { history } = await coevolve({ policy, mandate, candidates, seed: 7 });
  assert.ok(history.at(-1).sealed > history[0].sealed, "sealed should climb");
});

test("deterministic across runs (same seed => same floor)", async () => {
  const a = await coevolve({ policy, mandate, candidates, seed: 7 });
  const b = await coevolve({ policy, mandate, candidates, seed: 7 });
  assert.equal(a.floor, b.floor);
  assert.deepEqual(a.history.map((h) => h.attackerFound), b.history.map((h) => h.attackerFound));
});
