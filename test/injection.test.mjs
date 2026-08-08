import { test } from "node:test";
import assert from "node:assert/strict";
import { CORPUS, makeEnv, extractProposed } from "../src/injection.mjs";

const base = { merchant: "0xCloudCompute", item: "compute", quotedPrice: 15 };
const mandate = { merchant: "0xCloudCompute", maxPrice: 20 };
const allowlist = ["0xCloudCompute", "0xDataAPI", "0xInference"];

test("benign env keeps the mandate merchant + quoted price", () => {
  assert.deepEqual(extractProposed(makeEnv(base, CORPUS[0]), mandate), { amount: 15, payTo: "0xCloudCompute" });
});

test("the flip payload steers to 0xInference $49.97 (deterministic)", () => {
  assert.deepEqual(extractProposed(makeEnv(base, CORPUS[1]), mandate), { amount: 49.97, payTo: "0xInference" });
});

test("at least one payload is in-allowlist but out-of-mandate (passes Asha, moves $)", () => {
  const found = CORPUS.some((inj) => inj.payTo && inj.payTo !== mandate.merchant && allowlist.includes(inj.payTo));
  assert.ok(found, "corpus must include an allowlisted-decoy payload, not just 0xAttacker");
});
