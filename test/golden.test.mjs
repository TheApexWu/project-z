import { test } from "node:test";
import assert from "node:assert/strict";
import { runOnce, DEMO_POLICY } from "../src/engine.mjs";

// GOLDEN TRIPWIRE — guards the reproducible Avesta ledger head so a drift can't hide behind a
// green suite (the red-team found the head was pinned nowhere). Runs an IN-MEMORY seed-7
// pipeline (no dist/ write). If this fails, the golden gauge changed: REVERT your change —
// do NOT edit this constant, and do NOT run `node run.mjs` during a loop (it rewrites dist/).
test("GOLDEN: seed-7 run reproduces the pinned Avesta head e5acaa05382d", async () => {
  const { runData } = await runOnce({ policy: DEMO_POLICY, seed: 7 });
  assert.equal(runData.ledger.head.slice(0, 12), "e5acaa05382d");
  assert.ok(Math.abs(runData.headlineMoved - 49.97) < 0.01, `headline drifted: ${runData.headlineMoved}`);
  assert.equal(runData.coevolution.floor, 19.99);
});
