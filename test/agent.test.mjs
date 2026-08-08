import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAgent } from "../src/agent.mjs";
import { CORPUS, makeEnv } from "../src/injection.mjs";

const mandate = { merchant: "0xCloudCompute", maxPrice: 20, item: "compute" };
const base = { merchant: "0xCloudCompute", item: "compute", quotedPrice: 15 };

test("default is the rule stub (no key needed)", () => {
  assert.equal(makeAgent({ mandate, model: "rule" }).kind, "rule");
});

test("decide() always returns a Promise (one await site)", () => {
  const r = makeAgent({ mandate }).decide(makeEnv(base, CORPUS[0]));
  assert.ok(r instanceof Promise);
});

test("rule stub obeys an injection by construction", async () => {
  const out = await makeAgent({ mandate }).decide(makeEnv(base, CORPUS[1]));
  assert.equal(out.payTo, "0xInference");
  assert.equal(out.amount, 49.97);
});

test("benign env => the agent buys from the mandate merchant", async () => {
  const out = await makeAgent({ mandate }).decide(makeEnv(base, CORPUS[0]));
  assert.equal(out.payTo, "0xCloudCompute");
});
