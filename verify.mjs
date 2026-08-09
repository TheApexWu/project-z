#!/usr/bin/env node
// verify.mjs — the loop's ONLY gate. Nothing is "done" unless this exits 0.
//
// This file is FROZEN. If you believe a check here is wrong, STOP and write the reason in
// LOOP.md — do not edit it, do not add an id, do not soften an assert.
//
//   node verify.mjs gate        tests + frozen hashes + secret scan + no-float-money scan
//   node verify.mjs <ID>        milestone gate: assert evidence/<ID>.json  (M0..M9)
//   node verify.mjs status      one line per milestone (paste into LOOP.md)
//
// exit 0 = pass · 1 = not met (reason on stderr) · 2 = unknown id / harness error

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const FROZEN = ["verify.mjs", "shared/events.mjs", "src/rain.mjs", "src/rainsession.mjs"];
const MIN_TESTS = 3;
const RAIN_HOST = "api-dev.raincards.xyz";
const MCC_FOOD = "5814";

const fails = [];
const bad = (m) => fails.push(m);
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const num = (v) => typeof v === "number" && Number.isFinite(v);
const int = (v) => Number.isInteger(v);
const str = (v) => typeof v === "string" && v.trim().length > 0;

// A value the loop invented rather than read off the wire.
const FAKE = /^(0x0+$|0+$|test|fake|todo|tbd|n\/a|none|example|placeholder|dummy|sample|card_?123|tx_?123|abc|xxx|demo)/i;
const real = (v, min = 6) => str(v) && v.trim().length >= min && !FAKE.test(v.trim());
// Rain ids are uuids; a milestone claiming a card or transaction must show one.
const uuid = (v) => str(v) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());

function evidence(id) {
  const p = `evidence/${id}.json`;
  if (!existsSync(p)) { bad(`${p} missing — the milestone has produced no evidence`); return null; }
  let e;
  try { e = JSON.parse(readFileSync(p, "utf8")); }
  catch { bad(`${p} is not valid JSON`); return null; }
  return e;
}

// A milestone may declare itself blocked, but only with a specific human-actionable reason.
function blocked(e) {
  if (!e || e.blocked !== true) return false;
  if (!str(e.reason) || e.reason.trim().length < 20)
    { bad("blocked:true requires a specific reason naming what a human must do"); return false; }
  return true;
}

const CHECKS = {
  // Preflight: the Rain rail answers, and a plain card's cap enforces exactly.
  M0: (e) => {
    if (!int(e.spendingPower)) bad("M0.spendingPower must be integer cents from GET /issuing/balances");
    if (!uuid(e.cardId)) bad("M0.cardId must be a real Rain card uuid");
    if (!uuid(e.approvedTxId)) bad("M0.approvedTxId must be a real transaction uuid");
    if (e.declinedReason !== "card_spending_limit_exceeded")
      bad(`M0.declinedReason must be "card_spending_limit_exceeded", got ${JSON.stringify(e.declinedReason)}`);
  },

  // The state machine's invariant is the whole point; assert it was actually exercised.
  M1: (e) => {
    if (!int(e.budgetTotal)) bad("M1.budgetTotal must be integer cents");
    if (!int(e.groupTotal)) bad("M1.groupTotal must be integer cents");
    if (e.groupTotal > e.budgetTotal) bad("M1: group total exceeded the budget — the invariant is broken");
    if (!int(e.poolRemaining)) bad("M1.poolRemaining must be integer cents");
    if (e.groupTotal + e.poolRemaining !== e.budgetTotal)
      bad(`M1: ${e.groupTotal} + ${e.poolRemaining} !== ${e.budgetTotal} — conservation violated`);
    if (!Array.isArray(e.partialFillDonors) || e.partialFillDonors.length < 2)
      bad("M1.partialFillDonors must show a request filled by 2+ donors — partial fills are the feature");
    if (!num(e.tests) || e.tests < 6) bad("M1.tests must record at least 6 passing order tests");
  },

  M2: (e) => {
    if (!Array.isArray(e.menu) || e.menu.length < 5) bad("M2.menu needs 5+ items");
    for (const it of e.menu || []) {
      if (!int(it.priceCents)) bad(`M2 menu item ${it.sku}: priceCents must be integer cents`);
    }
    if (!str(e.llmsTxt) || e.llmsTxt.length < 80) bad("M2.llmsTxt must contain the actual llms.txt body (80+ chars)");
    if (!existsSync("public/llms.txt")) bad("M2: public/llms.txt does not exist on disk");
  },

  // The finale. Every id here must have come off the wire.
  M3: (e) => {
    if (!uuid(e.cardId)) bad("M3.cardId must be a real scoped-card uuid");
    if (!real(e.last4, 4)) bad("M3.last4 must be the real last4 off the issuance response");
    if (!int(e.totalCents)) bad("M3.totalCents must be integer cents");
    if (e.declinedReason !== "scoped_card_mcc_not_allowed")
      bad(`M3.declinedReason must be Rain's own "scoped_card_mcc_not_allowed", got ${JSON.stringify(e.declinedReason)}`);
    if (e.forcedDecline === true) bad("M3: a forced decline is not evidence — never pass declineReason");
    if (!uuid(e.approvedTxId)) bad("M3.approvedTxId must be a real transaction uuid");
    if (!Array.isArray(e.allowedMccs) || e.allowedMccs[0] !== MCC_FOOD)
      bad(`M3.allowedMccs must be ["${MCC_FOOD}"]`);
    if (!int(e.spendingPowerBefore) || !int(e.spendingPowerAfter))
      bad("M3 must record spendingPower before and after from GET /issuing/balances");
    if (int(e.spendingPowerBefore) && int(e.spendingPowerAfter) && e.spendingPowerAfter >= e.spendingPowerBefore)
      bad("M3: spendingPower did not fall — no money moved on Rain's own books");
  },

  // The reversal must release the hold to the cent, proven against Rain's balances.
  M4: (e) => {
    if (!uuid(e.reversedTxId)) bad("M4.reversedTxId must be a real transaction uuid");
    if (!int(e.reversedCents) || e.reversedCents <= 0) bad("M4.reversedCents must be positive integer cents");
    if (!int(e.pendingBefore) || !int(e.pendingAfter))
      bad("M4 must record pendingCharges before and after");
    if (int(e.pendingBefore) && int(e.pendingAfter) && (e.pendingBefore - e.pendingAfter) !== e.reversedCents)
      bad(`M4: hold released ${e.pendingBefore - e.pendingAfter} but reversed ${e.reversedCents} — must match to the cent`);
  },

  M5: (e) => {
    if (!num(e.port)) bad("M5.port must be the port the server actually bound");
    if (!num(e.replayedEvents) || e.replayedEvents < 5)
      bad("M5.replayedEvents must show a websocket client received 5+ events replayed from index 0");
    if (e.demoModeWorks !== true) bad("M5: ?demo=1 canned replay must work so the renderer builds without a backend");
  },

  M6: (e) => {
    for (const f of ["renderer/index.html", "renderer/hanami.js"])
      if (!existsSync(f)) bad(`M6: ${f} does not exist`);
    if (!Array.isArray(e.beatsRendered)) { bad("M6.beatsRendered must list the event types the renderer handles"); return; }
    for (const need of ["order_started", "budget_traded", "card_issued", "auth_declined", "auth_reversed"])
      if (!e.beatsRendered.includes(need)) bad(`M6: renderer does not handle ${need} — required beat`);
    if (e.externalRequests !== 0) bad("M6: renderer must make ZERO external requests — no CDN, venue wifi will fail");
    if (e.toleratesUnknownEvents !== true) bad("M6: renderer must ignore unknown event types without throwing");
  },

  // The spine. This is the thing that gets filmed.
  M7: (e) => {
    if (e.live !== true) bad("M7.live must be true — the filmed run is against the real sandbox");
    if (!uuid(e.cardId)) bad("M7.cardId must be the real card from the end-to-end run");
    if (!int(e.groupTotal)) bad("M7.groupTotal must be integer cents");
    if (!Array.isArray(e.eventLog) || e.eventLog.length < 12)
      bad("M7.eventLog must contain 12+ event types emitted in one end-to-end run");
    for (const need of ["order_started", "budget_traded", "card_issued", "auth_declined", "auth_approved", "auth_settled"])
      if (!(e.eventLog || []).includes(need)) bad(`M7: end-to-end run never emitted ${need}`);
    if (!num(e.wallClockSec)) bad("M7.wallClockSec must record how long the run takes — it has to fit in a 3-min video");
  },

  M8: (e) => {
    if (!Array.isArray(e.transfers) || e.transfers.length < 1) { bad("M8.transfers needs 1+ real transfers"); return; }
    for (const t of e.transfers) {
      if (!str(t.txHash) || !/^0x[0-9a-f]{64}$/i.test(t.txHash)) bad(`M8: ${t.txHash} is not a real 32-byte tx hash`);
      if (!num(t.confirmedMs)) bad("M8: each transfer must record measured confirmedMs");
      if (!int(t.amount)) bad("M8: transfer amount must be integer cents");
    }
    if (e.chainId !== 10143) bad("M8.chainId must be 10143 (Monad testnet)");
  },

  M9: (e) => {
    if (e.ordersDriven == null || !num(e.ordersDriven) || e.ordersDriven < 1)
      bad("M9.ordersDriven must show at least one order driven through Slack");
  },
};

function gate() {
  // 1. frozen files
  const pins = existsSync(".frozen.json") ? JSON.parse(readFileSync(".frozen.json", "utf8")) : null;
  if (!pins) {
    // first run: nothing to compare against. The loop must not silently proceed forever.
    console.error("note: .frozen.json absent — run `node verify.mjs freeze` once to pin frozen files");
  } else {
    for (const f of FROZEN) {
      if (!existsSync(f)) { bad(`frozen file ${f} is missing`); continue; }
      if (pins[f] && pins[f] !== sha(f)) bad(`frozen file ${f} was modified — revert it and note the reason in LOOP.md`);
    }
  }

  // 2. tests
  let out = "";
  try { out = execFileSync("node", ["--test"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (err) { out = (err.stdout || "") + (err.stderr || ""); }
  const pass = Number((out.match(/^# pass (\d+)/m) || out.match(/pass (\d+)/) || [])[1] || 0);
  const fail = Number((out.match(/^# fail (\d+)/m) || out.match(/fail (\d+)/) || [])[1] || 0);
  if (fail > 0) bad(`${fail} test(s) failing`);
  if (pass < MIN_TESTS) bad(`only ${pass} tests passing, need >= ${MIN_TESTS}`);

  // 3. secret scan across tracked files
  let tracked = [];
  try { tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean); }
  catch { /* not a repo yet */ }
  const SECRET = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b0x[a-fA-F0-9]{64}\b/,                    // a private key pasted into source
    /Api-Key\s*[:=]\s*["'][0-9a-f]{32,}["']/i,  // a literal api key
  ];
  for (const f of tracked) {
    if (!existsSync(f) || /\.(png|jpg|jpeg|gif|pdf|heic|ico|woff2?)$/i.test(f)) continue;
    let body = "";
    try { body = readFileSync(f, "utf8"); } catch { continue; }
    for (const re of SECRET) if (re.test(body)) bad(`possible secret committed in ${f}`);
  }
  if (tracked.includes(".env.local")) bad(".env.local is TRACKED — it must stay gitignored");

  // 4. non-sandbox host
  for (const f of tracked) {
    if (!/\.(mjs|js|json|ts)$/.test(f) || !existsSync(f)) continue;
    const body = readFileSync(f, "utf8");
    if (/raincards\.xyz/.test(body) && !body.includes(RAIN_HOST))
      bad(`${f} references a Rain host that is not the sandbox ${RAIN_HOST}`);
  }

  // 5. float money: a literal cents field assigned a decimal
  for (const f of tracked) {
    if (!/^(src|shared)\/.*\.mjs$/.test(f) || !existsSync(f)) continue;
    const body = readFileSync(f, "utf8");
    const m = body.match(/\b(amount|total|spent|remaining|priceCents|budgetTotal)\w*\s*[:=]\s*\d+\.\d+/);
    if (m) bad(`${f}: money field assigned a float (${m[0]}) — integer cents only`);
  }
}

function freeze() {
  const pins = {};
  for (const f of FROZEN) if (existsSync(f)) pins[f] = sha(f);
  process.stdout.write(JSON.stringify(pins, null, 2) + "\n");
}

function status() {
  const ids = Object.keys(CHECKS);
  for (const id of ids) {
    const p = `evidence/${id}.json`;
    if (!existsSync(p)) { console.log(`${id}  TODO`); continue; }
    let e; try { e = JSON.parse(readFileSync(p, "utf8")); } catch { console.log(`${id}  BADJSON`); continue; }
    if (e.blocked === true) { console.log(`${id}  BLOCKED  ${String(e.reason || "").slice(0, 70)}`); continue; }
    const before = fails.length;
    try { CHECKS[id](e); } catch { bad("check threw"); }
    console.log(`${id}  ${fails.length === before ? "PASS" : "FAIL"}`);
    fails.length = before;
  }
}

const arg = process.argv[2];
if (!arg) { console.error("usage: verify.mjs <gate|status|freeze|M0..M9>"); process.exit(2); }

if (arg === "freeze") { freeze(); process.exit(0); }
if (arg === "status") { status(); process.exit(0); }
if (arg === "gate") {
  gate();
} else if (CHECKS[arg]) {
  const e = evidence(arg);
  if (e && !blocked(e)) { try { CHECKS[arg](e); } catch (err) { bad(`check threw: ${err.message}`); } }
} else {
  console.error(`unknown id ${arg}`); process.exit(2);
}

if (fails.length) { for (const f of fails) console.error("FAIL: " + f); process.exit(1); }
console.log(`${arg} OK`);
process.exit(0);
