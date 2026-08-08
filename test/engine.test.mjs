import { test } from "node:test";
import assert from "node:assert/strict";
import { runOnce, DEMO_POLICY } from "../src/engine.mjs";

test("runOnce reproduces the golden find at the demo policy", async () => {
  const { runData } = await runOnce({ policy: DEMO_POLICY, seed: 7 });
  assert.equal(runData.drujBest.payTo, "0xInference");
  assert.ok(Math.abs(runData.headlineMoved - 49.97) < 0.5, `headline ${runData.headlineMoved}`);
  assert.equal(runData.drujBest.level, 5);
  assert.equal(runData.ledger.verified, true);
});

test("runOnce is a pure pipeline: two calls agree (byte-identical ledger head)", async () => {
  const a = await runOnce({ policy: DEMO_POLICY, seed: 7 });
  const b = await runOnce({ policy: DEMO_POLICY, seed: 7 });
  assert.equal(a.runData.ledger.head, b.runData.ledger.head);
  assert.equal(a.runData.headlineMoved, b.runData.headlineMoved);
});

test("judge-picks-policy is honest: a tighter cap seals the $49.97 flip", async () => {
  const { runData } = await runOnce({ policy: { ...DEMO_POLICY, cap: 25 }, seed: 7 });
  assert.ok(runData.headlineMoved <= 25, `at cap 25 the max flip must be <= 25, got ${runData.headlineMoved}`);
});

test("scene is collected for the animation (12 gens x 60 trials)", async () => {
  const { runData } = await runOnce({ policy: DEMO_POLICY, seed: 7 });
  assert.ok(Array.isArray(runData.scene) && runData.scene.length === 12, "12 generations");
  assert.equal(runData.scene[0].trials.length, 60, "60 trials/gen");
  const t = runData.scene[0].trials[0];
  assert.ok("amount" in t && "payTo" in t && "level" in t && "moved" in t, "trial shape");
});

test("coevolution floor rides along in runData", async () => {
  const { runData } = await runOnce({ policy: DEMO_POLICY, seed: 7 });
  assert.ok(runData.coevolution.floor > 0, "non-zero floor");
  assert.ok(runData.coevolution.history.length >= 3, "several arms-race rounds");
});

test("the re-rank still holds (Druj-flip climbs #succ -> #$)", async () => {
  const { view } = await runOnce({ policy: DEMO_POLICY, seed: 7 });
  assert.equal(view.bench.leaderboard.rerankMoved, true);
});
