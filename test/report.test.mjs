import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "../src/report.mjs";

const d = {
  meta: { title: "T", subtitle: "s", banner: "b", generatedAt: "x", seed: 7 },
  headlineMoved: 49.97,
  cap: 50,
  baseline: [{ name: "n", detail: "d", verdict: "ALLOW", pass: true }],
  drujTrace: [{ gen: 0, bestFitness: 100 }, { gen: 1, bestFitness: 250 }],
  drujBest: { amount: 49.97, payTo: "<script>alert(1)</script>", level: 5, label: "flip" },
  ranking: { byASR: [{ name: "a", asr: 0.9, dollars: 2, risk: 1.8 }], byRisk: [{ name: "a", asr: 0.9, dollars: 2, risk: 1.8 }], totalAtRisk: 1.8 },
  rankingHotName: "a",
  rerankMoved: true,
  perProfile: [{ profile: "tight", dollarsSlipped: 10 }],
  ledger: { head: "abcdef0123456789", count: 3, verified: true },
};

test("report is self-contained: has the headline $, NO external URLs, chain-VERIFIED badge", () => {
  const h = renderReport(d);
  assert.ok(h.includes("$49.97"));
  assert.ok(!/https?:\/\//.test(h), "must not reference any external URL");
  assert.ok(h.includes("VERIFIED"));
});

test("agent-derived strings are escaped (no raw <script>)", () => {
  assert.ok(!renderReport(d).includes("<script>alert(1)</script>"));
});
