#!/usr/bin/env node
// verify.mjs — the loop's ONLY gate. Nothing is "done" unless this exits 0.
//
// LOOP: this file is FROZEN. Its sha256 is pinned in prompt.md (which the runner re-supplies
// each iteration, so editing the repo copy buys nothing). If you believe a check here is wrong,
// STOP and record it in LOOP.md — do not edit it, do not add an id, do not soften an assert.
//
//   node verify.mjs gate        exit gate: tests + frozen hashes + tripwire + secret scan
//   node verify.mjs <ID>        milestone gate: assert evidence/<ID>.json  (P0 A1 A2 A3 A4 B2 B3 B4 I1 I2 I3)
//   node verify.mjs status      one line per milestone (paste into LOOP.md)
//
// exit 0 = pass · 1 = not met (reason on stderr) · 2 = unknown id / harness error

import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// sha256 of every file the loop may NOT touch. A mismatch voids the iteration.
const FROZEN = {
  "src/engine.mjs":            "64a56064b6861b1aa1e606ebea7a01c50fc3cefb277b4e8ddd21b2c65d808d54",
  "src/avesta.mjs":            "0bd8a85a560cc43a7da0d0649acbc88a4bb89f23b76a31dcd0473dfc6998fd16",
  "src/x402mock.mjs":          "7d4de72db87cb3fd368b3b42fc535a0b7339bc52846cc45b56efb1d4e89ff541",
  "test/agent.test.mjs":       "a0c00225afd10de0e539aeede7cc1a9fe4550ad01f3d5be4976eb09c763f838a",
  "test/asha.test.mjs":        "47b4e559883e6879b885ca7b010678139f3f6b2ed2c88c44b2e8cc4ff5cc475a",
  "test/avesta.test.mjs":      "cdaa04825e1cd8427996a0e9269fa1206677c96a5a71b2e2dce727a959a5115c",
  "test/coevolve.test.mjs":    "56e697a641b6b3170deeccaf95364e81cb687488c8db3ed40e4e935eee503eee",
  "test/druj.test.mjs":        "02d778a7e1a9da5c2a82afaecf473a32867c83f238406a07b00b6e293dabc52f",
  "test/engine.test.mjs":      "6c1bf46313656b1c90ae0227a755a966f4f905524a9af3370b26ec2fa9a2a2d6",
  "test/harness.test.mjs":     "2ad419e5d195f7ce5ca249ca68bab9c8bbeef6e0aceb9500b7e2d4672c27ab7e",
  "test/injection.test.mjs":   "ee7128e52a0ef69b7c705f38aa97a1b656a7c2403bb4696dbe83ca6d06efe443",
  "test/oracle.test.mjs":      "4446b002b6fb98c8bd326b01609dce9d4df93a75b3e06d5acb42b619e27c08ab",
  "test/report.test.mjs":      "344955c74e7d0acaa42709c90a9d3d6b50732874f4f83081c8d6ad3f1227d08a",
  "test/settlement.test.mjs":  "5ffc35b60e88b804e058afb510c175513b2c88accaacf0c1e6f9f8e1af7029a7",
};
const GOLDEN_HEAD = "e5acaa05382d";
const MIN_TESTS = 48;          // may grow, never shrink
const MIN_GOLDEN_ASSERTS = 4;  // golden.test.mjs is editable (live asserts) but may not get weaker
const MONAD_CHAIN_ID = 10143;
const RAIN_HOST = "api-dev.raincards.xyz";

const fails = [];
const bad = (m) => fails.push(m);
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const num = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v) => typeof v === "string" && v.trim().length > 0;
// a value the loop invented rather than read off the wire
const FAKE = /^(0x0+|0+|test|fake|todo|tbd|n\/a|none|example|placeholder|dummy|sample|card_?123|tx_?123|abc|xxx)/i;
const real = (v, min = 6) => str(v) && v.trim().length >= min && !FAKE.test(v.trim());

function evidence(id) {
  const p = `evidence/${id}.json`;
  if (!existsSync(p)) { bad(`${p} missing — run the milestone for real, then write its evidence`); return null; }
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { bad(`${p} is not valid JSON: ${e.message}`); return null; }
}

// ---------- gate ----------
function gate() {
  for (const [p, want] of Object.entries(FROZEN)) {
    if (!existsSync(p)) { bad(`FROZEN file deleted: ${p}`); continue; }
    const got = sha(p);
    if (got !== want) bad(`FROZEN file modified: ${p}\n    want ${want}\n    got  ${got}\n    -> git checkout -- ${p}`);
  }
  if (existsSync("test/golden.test.mjs")) {
    const g = readFileSync("test/golden.test.mjs", "utf8");
    if (!g.includes(GOLDEN_HEAD)) bad(`tripwire lost the golden head ${GOLDEN_HEAD} — revert test/golden.test.mjs`);
    const n = (g.match(/assert/g) || []).length;
    if (n < MIN_GOLDEN_ASSERTS) bad(`tripwire weakened: ${n} asserts, min ${MIN_GOLDEN_ASSERTS}`);
    if (/\.skip\(|\.todo\(|it\.only|test\.only/.test(g)) bad("tripwire has a skipped/only test — not allowed");
  } else bad("test/golden.test.mjs missing");

  let out = "";
  try { out = execFileSync("node", ["--test"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000 }); }
  catch (e) { out = `${e.stdout || ""}${e.stderr || ""}`; bad("node --test exited non-zero"); }
  const tests = +(out.match(/tests (\d+)/)?.[1] ?? -1);
  const failed = +(out.match(/[^_]fail (\d+)/)?.[1] ?? -1);
  const skipped = +(out.match(/skipped (\d+)/)?.[1] ?? 0);
  const todo = +(out.match(/todo (\d+)/)?.[1] ?? 0);
  if (failed !== 0) bad(`node --test: fail ${failed}`);
  if (tests < MIN_TESTS) bad(`node --test: ${tests} tests, min ${MIN_TESTS} (a test was deleted)`);
  if (skipped + todo > 0) bad(`node --test: ${skipped} skipped + ${todo} todo — a self-skipping green test is a failure`);
  else if (failed === 0 && tests >= MIN_TESTS) console.log(`tests ${tests} · fail 0 · skipped 0`);

  secrets();
}

function secrets() {
  let tracked = [];
  try { tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean); }
  catch { bad("git ls-files failed — is this a repo?"); return; }
  const ALLOW_HEX = new Set(["verify.mjs", "PRD.json", "prompt.md", "ANCHOR.md", "LOOP.md"]);
  for (const f of tracked) {
    if (/(^|\/)\.env($|\.)|wallet.*\.json$|\.key$|\.pem$/.test(f)) { bad(`SECRET-SHAPED FILE TRACKED: ${f} — git rm --cached it`); continue; }
    if (!existsSync(f) || statSync(f).size > 2_000_000) continue;
    const t = readFileSync(f, "utf8");
    if (/(PRIVATE_KEY|PRIVKEY|MNEMONIC|SEED_PHRASE|Api-?Key|apiKey|sessionId|RAIN_API_KEY)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/.test(t))
      bad(`possible credential committed in ${f}`);
    if (!ALLOW_HEX.has(f) && /(^|[^0-9a-fA-Fx])[0-9a-fA-F]{64}([^0-9a-fA-F]|$)/.test(t))
      bad(`bare 64-hex (private-key shaped) in ${f}`);
  }
}

// ---------- milestones ----------
const M = {
  // P0 — tools/env/keys, re-run at the START of every iteration. Blocked lanes are legal here;
  // P0 passes when the environment has been HONESTLY recorded, not when everything is unlocked.
  P0(e) {
    if (!num(e.nodeMajor) || e.nodeMajor < 20) bad("P0: nodeMajor missing or < 20");
    if (e.gate !== "pass") bad("P0: gate must be 'pass' (run `node verify.mjs gate` first)");
    for (const lane of ["rain", "monad"]) {
      const v = e.lanes?.[lane];
      if (!str(v) || !(v === "ready" || v.startsWith("blocked:"))) bad(`P0: lanes.${lane} must be "ready" or "blocked:<missing vars>"`);
    }
    if (!str(e.checkedAt)) bad("P0: checkedAt (ISO) missing");
    if (JSON.stringify(e).match(/[A-Za-z0-9_\-]{24,}/g)?.some((s) => !/^[\w.:+\-]+$/.test(s))) bad("P0: evidence looks like it contains a key — record presence only, never values");
  },
  // A1 — a scoped card really exists on Rain's sandbox.
  A1(e) {
    if (!real(e.cardId, 8)) bad("A1: cardId missing/placeholder — must be the id Rain returned");
    if (!Number.isInteger(e.capCents) || e.capCents <= 0) bad("A1: capCents must be a positive integer (cents)");
    if (!Array.isArray(e.allowedMccs) || e.allowedMccs.length === 0) bad("A1: allowedMccs must be a non-empty array");
    if (!str(e.apiBase) || !e.apiBase.includes(RAIN_HOST)) bad(`A1: apiBase must be the sandbox host ${RAIN_HOST}`);
    if (e.source !== "live") bad("A1: source must be 'live' — the mock cannot satisfy a Rain milestone");
  },
  // A2 — money moved AND the ledger says so. The read-back is the anti-fake: a settle response
  // the loop invented will not appear in GET /issuing/transactions.
  A2(e) {
    const a1 = evidence("A1"); if (!a1) return;
    if (e.positive?.settled !== true) bad("A2: positive.settled must be true");
    if (!real(e.positive?.txId, 6)) bad("A2: positive.txId missing/placeholder");
    if (!Number.isInteger(e.positive?.amountCents) || e.positive.amountCents <= 0) bad("A2: positive.amountCents must be a positive integer");
    if (!Array.isArray(e.readback?.ids)) bad("A2: readback.ids must be the id list from GET /issuing/transactions");
    else if (!e.readback.ids.includes(e.positive?.txId)) bad("A2: positive.txId is NOT in the read-back — the settle was not observed by Rain");
    if (e.cardId !== a1.cardId) bad("A2: cardId does not match A1");
  },
  // A3 — the pitch. EITHER outcome passes; a MISSING control or a conclusion that contradicts the
  // numbers does not. The recorded conclusion is recomputed here so the narrative cannot drift.
  A3(e) {
    const a2 = evidence("A2"); if (!a2) return;
    const { positive, flip, negative } = e;
    for (const [k, v] of Object.entries({ positive, flip, negative }))
      if (!v || typeof v.settled !== "boolean") { bad(`A3: control '${k}' missing or has no boolean .settled`); return; }
    if (!Number.isInteger(e.capCents) || e.capCents <= 0) return bad("A3: capCents missing");
    if (flip.amountCents > e.capCents) bad("A3: the flip was OVER the cap — that is not an in-policy flip, it is the control working");
    if (flip.mcc !== positive.mcc) bad("A3: the flip must reuse the ALLOWED mcc (same category, wrong merchant)");
    if (flip.merchantName === positive.merchantName) bad("A3: the flip must use a DIFFERENT merchant");
    if (negative.mcc === positive.mcc) bad("A3: the negative control must use an OUT-of-allowlist mcc");
    const expect = !flip.settled ? "flip-declined" : negative.settled ? "sandbox-passthrough" : "residual-confirmed";
    if (e.conclusion !== expect) bad(`A3: conclusion '${e.conclusion}' contradicts the data — the numbers say '${expect}'`);
    if (expect === "sandbox-passthrough" && !str(e.narrationCaveat))
      bad("A3: out-of-MCC also settled, so the sim did not enforce scope — narrationCaveat is REQUIRED before this is shown");
  },
  // A4 — the gauge priced REAL observed Rain transactions, not the mock corpus.
  A4(e) {
    const a3 = evidence("A3"); if (!a3) return;
    if (!num(e.dollarsAtRisk) || e.dollarsAtRisk < 0) bad("A4: dollarsAtRisk must be a number >= 0");
    if (e.source !== "rain-live") bad("A4: source must be 'rain-live'");
    if (!Array.isArray(e.inputs?.txIds) || e.inputs.txIds.length < 3) bad("A4: inputs.txIds must list >= 3 observed Rain txn ids");
    const seen = new Set(evidence("A2")?.readback?.ids ?? []);
    if (seen.size && e.inputs?.txIds?.some((t) => !seen.has(t))) bad("A4: an input txId was never observed in the A2 read-back — the gauge scored something invented");
    if (!str(e.method)) bad("A4: method — one line on how dollarsAtRisk was computed");
  },
  // B2 — the signature is real and was NOT broadcast.
  B2(e) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(e.wallet || "")) bad("B2: wallet must be a 0x address");
    if ((e.recoveredSigner || "").toLowerCase() !== (e.wallet || "").toLowerCase()) bad("B2: recoveredSigner !== wallet — the EIP-3009 signature does not verify");
    if (e.chainId !== MONAD_CHAIN_ID) bad(`B2: chainId must be ${MONAD_CHAIN_ID} (Monad testnet)`);
    if (e.broadcast !== false) bad("B2: broadcast must be false — B2 is dry-run only");
    if (str(e.signature)) bad("B2: NEVER write the signature to evidence — it is a bearer instrument. Record recoveredSigner only");
  },
  // B3 — exactly one real testnet settlement, receipted on chain.
  B3(e) {
    const b2 = evidence("B2"); if (!b2) return;
    if (!/^0x[0-9a-f]{64}$/i.test(e.txHash || "")) bad("B3: txHash must be a 0x + 64 hex receipt hash");
    if (e.status !== "success") bad("B3: status must be 'success' (from the on-chain receipt, not the facilitator's word)");
    if ((e.from || "").toLowerCase() !== (b2.wallet || "").toLowerCase()) bad("B3: receipt.from !== the B2 wallet");
    if (e.chainId !== MONAD_CHAIN_ID) bad(`B3: chainId must be ${MONAD_CHAIN_ID}`);
    if (!Number.isInteger(e.blockNumber) || e.blockNumber <= 0) bad("B3: blockNumber must be a positive integer");
    if (!num(e.amountUsdc) || !num(e.maxTestUsdc) || e.amountUsdc > e.maxTestUsdc) bad("B3: amountUsdc must be recorded and <= maxTestUsdc");
    if (e.settlementCount !== 1) bad("B3: settlementCount must be exactly 1 — one send per invocation");
  },
  // B4 — the finality number is measured or absent. Never interpolated.
  B4(e) {
    const b3 = evidence("B3"); if (!b3) return;
    if (e.txHash !== b3.txHash) bad("B4: txHash must be the B3 settlement");
    if (e.measuredWindowMs === null || e.measuredWindowMs === undefined) bad("B4: finality was not reached — do NOT record a number; re-run, or mark the milestone blocked");
    else if (!num(e.measuredWindowMs) || e.measuredWindowMs <= 0) bad("B4: measuredWindowMs must be a positive number of ms");
    if (!Number.isInteger(e.finalizedBlock) || e.finalizedBlock < b3.blockNumber) bad("B4: finalizedBlock must be >= the B3 blockNumber");
    if (e.reversibilitySuggested !== null && e.humanReviewed !== true) bad("B4: a reversibility mapping may not enter the gauge without humanReviewed:true");
  },
  // improve backlog
  I1(e) { // one-command demo
    if (!str(e.command)) bad("I1: command missing");
    if (e.exitCode !== 0) bad("I1: the demo command must exit 0");
    if (!num(e.durationSec) || e.durationSec > 180) bad("I1: durationSec must be recorded and <= 180 (it runs on stage)");
    if (!Array.isArray(e.steps) || e.steps.length < 3) bad("I1: steps must list what the operator sees");
  },
  I2(e) { // README/docs numbers trace to evidence
    if (!Array.isArray(e.claims) || e.claims.length === 0) return bad("I2: claims[] missing");
    for (const c of e.claims) {
      if (!str(c.text) || !str(c.source)) { bad("I2: every claim needs {text, source}"); continue; }
      if (!/^evidence\/[A-Z0-9]+\.json/.test(c.source) && c.source !== "mock-golden")
        bad(`I2: claim "${String(c.text).slice(0, 40)}" cites '${c.source}' — must cite an evidence/ file or 'mock-golden'`);
    }
  },
  I3(e) { // failure path rehearsed
    if (!Array.isArray(e.rehearsed) || e.rehearsed.length < 2) bad("I3: rehearse >= 2 failure modes (creds dead, network dead)");
    for (const r of e.rehearsed) if (!str(r.mode) || !str(r.observed)) bad("I3: each entry needs {mode, observed}");
  },
};

// ---------- main ----------
const id = process.argv[2];
if (!id) { console.error("usage: node verify.mjs <gate|status|MILESTONE_ID>"); process.exit(2); }

if (id === "status") {
  for (const k of Object.keys(M)) {
    const before = fails.length;
    const e = evidence(k); if (e) M[k](e);
    console.log(`${k} ${fails.length === before ? "PASS" : "FAIL"}`);
    fails.length = before;
  }
  process.exit(0);
}

if (id === "gate") gate();
else if (M[id]) { const e = evidence(id); if (e) M[id](e); }
else { console.error(`unknown id '${id}' — this milestone has NO machine gate. Do not mark it done. Record it in LOOP.md and STOP.`); process.exit(2); }

if (fails.length) { console.error(`FAIL ${id}:\n  - ${fails.join("\n  - ")}`); process.exit(1); }
console.log(`PASS ${id}`);
