import { test } from "node:test";
import assert from "node:assert/strict";
import { runBenchmark } from "../src/harness.mjs";
import { CORPUS } from "../src/corpus.mjs";
import { PROFILES, PROFILE_ORDER } from "../src/profiles.mjs";

const mandate = { merchant: "0xCloudCompute", maxPrice: 20, windowCap: 20, windowMs: 1000 };
const run = (seed = 1) => runBenchmark({ corpus: CORPUS, profiles: PROFILES, profileOrder: PROFILE_ORDER, mandate, trials: 60, seed, reorgRate: 0.2 });

test("determinism: same seed => identical leaderboard", () => {
  const a = run(1), b = run(1);
  assert.deepEqual(a.leaderboard.byRisk.map((r) => r.name), b.leaderboard.byRisk.map((r) => r.name));
  assert.equal(a.leaderboard.totalAtRisk, b.leaderboard.totalAtRisk);
});

test("no-gate control slips strictly more $ than tight", () => {
  const b = run(1);
  const p = Object.fromEntries(b.perProfile.map((x) => [x.profile, x.dollarsSlipped]));
  assert.ok(p["no-gate"] > p["tight"], `no-gate ${p["no-gate"]} !> tight ${p["tight"]}`);
});

test("the $-ranking genuinely differs from the success-ranking (the H5 claim)", () => {
  const b = run(1);
  assert.equal(b.leaderboard.rerankMoved, true);
});

test("the hero attack climbs from a worse success-rank to a better $-rank", () => {
  const h = run(1).leaderboard.hero;
  assert.ok(h.asrRank > h.riskRank, `hero ${h.name}: asrRank ${h.asrRank} should be worse (higher) than riskRank ${h.riskRank}`);
});

test("metrics stay in range (asr in [0,1])", () => {
  for (const r of run(1).leaderboard.byRisk) assert.ok(r.asr >= 0 && r.asr <= 1);
});
