import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFacilitator } from "../src/x402mock.mjs";
import { rng } from "../src/rng.mjs";

const p = (extra = {}) => ({ amount: 10, payTo: "0xCloudCompute", ...extra });

test("reorg=1 => reverted, moved 0 (models the free-ride)", () => {
  assert.deepEqual(makeFacilitator({ reorgRate: 1 }).settle(p()), { settled: false, reverted: true, moved: 0 });
});
test("reorg=0 => settled, full amount", () => {
  const r = makeFacilitator({ reorgRate: 0 }).settle(p());
  assert.equal(r.settled, true); assert.equal(r.moved, 10);
});
test("nonce dedupe blocks a replay", () => {
  const f = makeFacilitator({ reorgRate: 0 });
  const a = f.settle(p({ nonce: 1, dedupe: true }));
  const b = f.settle(p({ nonce: 1, dedupe: true }));
  assert.equal(a.settled, true);
  assert.equal(b.replayBlocked, true); assert.equal(b.moved, 0);
});
test("without dedupe the replay double-spends", () => {
  const f = makeFacilitator({ reorgRate: 0 });
  assert.equal(f.settle(p({ nonce: 1 })).moved, 10);
  assert.equal(f.settle(p({ nonce: 1 })).moved, 10);
});
test("a reverted settle consumes NO nonce — a retry is allowed (EIP-3009 semantics)", () => {
  const seq = [0.1, 0.9]; // first draw reverts (0.1 < 0.5), second settles (0.9 !< 0.5)
  let i = 0;
  const f = makeFacilitator({ reorgRate: 0.5, rand: () => seq[i++] });
  const q = p({ nonce: 7, dedupe: true });
  const a = f.settle(q);
  const b = f.settle(q);
  assert.equal(a.reverted, true); assert.equal(a.moved, 0);
  assert.equal(b.settled, true); assert.equal(b.moved, 10); // retry after revert must succeed, not replay-block
});

test("reorg sequence is seeded-deterministic", () => {
  const seq = () => Array.from({ length: 6 }, (_, i) => makeFacilitator({ reorgRate: 0.5, rand: rng(42) }));
  const a = makeFacilitator({ reorgRate: 0.5, rand: rng(42) });
  const b = makeFacilitator({ reorgRate: 0.5, rand: rng(42) });
  const sa = Array.from({ length: 6 }, () => a.settle(p()).moved);
  const sb = Array.from({ length: 6 }, () => b.settle(p()).moved);
  assert.deepEqual(sa, sb);
});
