import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Avesta — a tamper-evident, append-only evidence log of verdicts. Each entry
// hashes the previous, so any edit breaks the chain (recomputable sha256).
// HONEST SCOPE: this is a LOCAL hash-chained JSONL, NOT on-chain. A file holder
// can rewrite the whole chain from genesis and it re-verifies — there is no
// external anchor. The `sink` is the swap seam for a real Monad contract call.
export const GENESIS = "0".repeat(64);

// key-order-independent stringify so hashes are reproducible across runs.
function stable(o) {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(stable).join(",") + "]";
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + stable(o[k])).join(",") + "}";
}

export function hashEntry(seq, prevHash, verdict, ts) {
  return createHash("sha256").update(stable([seq, prevHash, ts, verdict])).digest("hex");
}

export function verifyChain(entries, genesis = GENESIS) {
  let prev = genesis;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.prevHash !== prev) return { ok: false, brokenAt: i, reason: "prevHash mismatch" };
    if (hashEntry(e.seq, e.prevHash, e.verdict, e.ts) !== e.hash) return { ok: false, brokenAt: i, reason: "hash mismatch" };
    prev = e.hash;
  }
  return { ok: true, brokenAt: null, reason: null };
}

export function makeLedger({ path = null, genesis = GENESIS, sink = null, clock = () => Date.now() } = {}) {
  const entries = [];
  let prev = genesis;
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, ""); // truncate — never accumulate stale evidence
  }

  function writeVerdict(verdict) {
    const seq = entries.length;
    const ts = clock();
    const hash = hashEntry(seq, prev, verdict, ts);
    const e = { seq, ts, prevHash: prev, verdict, hash };
    entries.push(e);
    prev = hash;
    if (path) appendFileSync(path, JSON.stringify(e) + "\n");
    if (sink) sink(e); // <- on-chain anchoring plugs in here
    return e;
  }

  return {
    writeVerdict,
    entries,
    head: () => prev,
    verify: (list = entries) => verifyChain(list, genesis),
  };
}
