import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAsha } from "../src/asha.mjs";
import { makeFacilitator } from "../src/x402mock.mjs";
import { evolve, randomSearch } from "../src/druj.mjs";

const allowlist = ["0xCloudCompute", "0xDataAPI", "0xInference"];
const mandate = { merchant: "0xCloudCompute", maxPrice: 20 };
const candidates = [...allowlist, "0xAttacker"];
const setup = () => ({ asha: makeAsha({ cap: 50, allowlist, priceRef: 20, priceBand: 3, velocity: 100, windowMs: 1000 }), facilitator: makeFacilitator({ reorgRate: 0 }) });

test("determinism: same seed => byte-identical best", async () => {
  const a = await evolve({ ...setup(), mandate, candidates, seed: 5, gens: 12, pop: 60 });
  const b = await evolve({ ...setup(), mandate, candidates, seed: 5, gens: 12, pop: 60 });
  assert.equal(a.best.fitness, b.best.fitness);
  assert.equal(a.best.p.amount, b.best.p.amount);
  assert.equal(a.best.p.payTo, b.best.p.payTo);
});

test("finds an in-policy L5 bypass past the $50 cap to an allowlisted decoy", async () => {
  const { best } = await evolve({ ...setup(), mandate, candidates, seed: 7, gens: 12, pop: 60 });
  assert.equal(best.level, 5);
  assert.equal(best.p.payTo, "0xInference");
  assert.ok(best.moved > 45 && best.moved <= 50, `moved=${best.moved}`);
});

test("H3 (honest): evolve mean fitness matches-or-exceeds equal-budget random search; margin is SMALL", async () => {
  let se = 0, sr = 0;
  const N = 20, budget = 12 * 60;
  for (let seed = 1; seed <= N; seed++) {
    se += (await evolve({ ...setup(), mandate, candidates, seed, gens: 12, pop: 60 })).best.fitness;
    sr += randomSearch({ ...setup(), mandate, candidates, seed, budget }).fitness;
  }
  const me = se / N, mr = sr / N;
  assert.ok(me >= mr - 0.01, `evolve ${me.toFixed(2)} should match-or-exceed random ${mr.toFixed(2)}`);
  assert.ok(me - mr < 5, `margin ${(me - mr).toFixed(2)} must stay small — never claim 'evolution dominates'`);
});
