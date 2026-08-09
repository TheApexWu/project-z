// preflight.mjs — M0. Prove the Rain rail answers before any product code exists.
//
// Deliberately uses a PLAIN card, not a scoped one: scoped cards are rationed (10 per user
// per rolling 24h) and are needed for the filmed run. A plain card also gives us the one
// thing a scoped card cannot — an amount that Rain actually enforces — so this doubles as
// the proof that our understanding of the two card types is correct.
//
//   node --env-file=.env.local preflight.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { makeRain } from "./src/rain.mjs";

const CAP = 500; // $5.00

const rain = makeRain();
const log = (...a) => console.log(...a);

log("Rain preflight — plain card, enforced cap\n");

const before = await rain.balances();
log(`balances: spendingPower=${before.spendingPower} pending=${before.pendingCharges} posted=${before.postedCharges}`);

const card = await rain.issuePlainCard(CAP, "perAuthorization");
log(`card: ${card.id} last4=${card.last4} cap=$${(CAP / 100).toFixed(2)} perAuthorization`);

const ok = await rain.authorize(card.id, {
  amount: CAP, merchantName: "Moon Palace Burgers", merchantCategoryCode: "5814",
});
log(`  auth $${(CAP / 100).toFixed(2)}  -> ${ok.status}${ok.declinedReason ? " " + ok.declinedReason : ""}`);

const over = await rain.authorize(card.id, {
  amount: CAP + 1, merchantName: "Moon Palace Burgers", merchantCategoryCode: "5814",
});
log(`  auth $${((CAP + 1) / 100).toFixed(2)}  -> ${over.status}${over.declinedReason ? " " + over.declinedReason : ""}`);

const after = await rain.balances();
log(`\nbalances: spendingPower=${after.spendingPower}  (moved ${before.spendingPower - after.spendingPower})`);

if (ok.status !== "authorized") throw new Error(`expected the at-cap authorization to approve, got ${ok.status}`);
if (over.declinedReason !== "card_spending_limit_exceeded")
  throw new Error(`expected card_spending_limit_exceeded, got ${JSON.stringify(over.declinedReason)}`);

mkdirSync("evidence", { recursive: true });
writeFileSync("evidence/M0.json", JSON.stringify({
  ranAt: new Date().toISOString(),
  live: true,
  spendingPower: after.spendingPower,
  cardId: card.id,
  last4: card.last4,
  capCents: CAP,
  approvedTxId: ok.transactionId,
  declinedTxId: over.transactionId,
  declinedReason: over.declinedReason,
  forcedDecline: false,
  spendingPowerBefore: before.spendingPower,
  spendingPowerAfter: after.spendingPower,
}, null, 2) + "\n");

log("\nwrote evidence/M0.json");
