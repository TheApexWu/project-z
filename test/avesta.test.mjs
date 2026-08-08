import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLedger, hashEntry, GENESIS } from "../src/avesta.mjs";

const clock = () => 0;

test("entries link: e1.prevHash === e0.hash, and the chain verifies", () => {
  const L = makeLedger({ clock });
  L.writeVerdict({ kind: "baseline", name: "a", moved: 0 });
  L.writeVerdict({ kind: "druj-best", name: "b", moved: 49.97 });
  assert.equal(L.entries[0].prevHash, GENESIS);
  assert.equal(L.entries[1].prevHash, L.entries[0].hash);
  assert.equal(L.verify().ok, true);
});

test("tampering the first entry is detected at brokenAt:0", () => {
  const L = makeLedger({ clock });
  L.writeVerdict({ kind: "baseline", name: "a", moved: 0 });
  L.writeVerdict({ kind: "rashnu", name: "b", moved: 5 });
  L.entries[0].verdict.moved = 999; // forge
  const v = L.verify();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 0);
});

test("hash is key-order independent (stable stringify)", () => {
  assert.equal(hashEntry(0, GENESIS, { a: 1, b: 2 }, 0), hashEntry(0, GENESIS, { b: 2, a: 1 }, 0));
});
