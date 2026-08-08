// rain.mjs — Rain sandbox demo (the Rain-track "agents move money" + the gauge on Rain's real API).
// Reads .env.local (gitignored). Usage: node --env-file=.env.local rain.mjs [--check | --demo]
import { makeRainSandbox } from "./src/rainsandbox.mjs";

const flags = new Set(process.argv.slice(2));
const NEED = ["RAIN_API_BASE", "RAIN_API_KEY", "RAIN_USER_ID", "RAIN_CONTRACT_ID", "RAIN_SESSION_ID"];
const missing = () => NEED.filter((k) => !process.env[k]);

function sandbox() {
  return makeRainSandbox({
    apiBase: process.env.RAIN_API_BASE, apiKey: process.env.RAIN_API_KEY,
    userId: process.env.RAIN_USER_ID, teamId: process.env.RAIN_TEAM_ID,
    contractId: process.env.RAIN_CONTRACT_ID, sessionId: process.env.RAIN_SESSION_ID,
  });
}

async function check() {
  console.log("Rain sandbox preflight:");
  NEED.forEach((k) => console.log(`  [${process.env[k] ? "OK " : "MISSING"}] ${k}`));
  const miss = missing();
  if (miss.length) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync("BLOCKED.md", `# BLOCKED (Rain sandbox)\nmissing: ${miss.join(", ")}\n\nGet keys at the workshop desk, fill .env.local, re-run \`node --env-file=.env.local rain.mjs --check\`.\n`);
    console.log(`\nBLOCKED — missing: ${miss.join(", ")}. Wrote BLOCKED.md.`);
    process.exit(1);
  }
  console.log("\npreflight OK — ready for --demo.");
}

// The demo IS the pitch: fund -> issue a scoped card ($42.99 cap) -> a LEGIT buy + an IN-POLICY
// FLIP (still under the cap, wrong merchant) -> settle -> read back. Whether Rain approves the
// flip is the whole question: if it does, the scoped card capped the amount but not the recipient,
// and that gap is the $-at-risk the gauge measures.
async function demo() {
  const s = sandbox();
  const MCC_ALLOWED = "5812"; // full-service restaurants — the card's allowed category
  const MCC_BLOCKED = "5999"; // misc retail — NOT on the allowlist (the negative control)
  console.log("1) fund collateral $1000.00 ..."); await s.fundCollateral(100000);
  console.log(`2) issue scoped card: cap $42.99, allowedMccs=[${MCC_ALLOWED}] ...`);
  const cardId = await s.issueScopedCard(4299, [MCC_ALLOWED]); console.log("   cardId:", cardId);
  const fac = s.facilitatorFor(cardId);

  // POSITIVE control — under cap, in-allowlist MCC -> expect APPROVED
  const pos = await fac.settle({ amount: 1500, merchantName: "Rossos-Trattoria", merchantCategoryCode: MCC_ALLOWED });
  console.log("3) POSITIVE  $15.00 in-MCC        :", pos.settled ? `APPROVED (${pos.txId})` : `declined (${pos.reason})`);

  // THE FLIP — under cap, SAME allowed MCC, WRONG merchant -> expect APPROVED (the in-policy residual)
  const flip = await fac.settle({ amount: 4297, merchantName: "Attacker-Diner", merchantCategoryCode: MCC_ALLOWED });
  console.log("4) FLIP      $42.97 wrong-merchant :", flip.settled ? `APPROVED (${flip.txId})  <- EXPOSURE` : `declined (${flip.reason})`);

  // NEGATIVE control — MCC NOT on the allowlist, NO declineReason -> does the sandbox ENFORCE scope?
  const neg = await fac.settle({ amount: 1500, merchantName: "Some-Shop", merchantCategoryCode: MCC_BLOCKED });
  console.log("5) NEGATIVE  $15.00 out-of-MCC     :", neg.settled ? "APPROVED  (sim does NOT auto-enforce)" : `DECLINED (${neg.reason})  (sim ENFORCES scope)`);

  // CAPTURE-DRIFT control — auth a clean under-cap amount, then CAPTURE a LARGER amount (still under
  // the cap). The cap gates the AUTHORIZATION; the capture is a separate later event. Does Rain
  // re-check the cap at capture, or does the drift ride the auth/clearing split? Either answer is honest.
  const D_AUTH = 1000, D_CAP = 4298; // authorize $10.00, capture $42.98 — both under the $42.99 cap
  let driftHit = false, driftMsg;
  const dAuth = await s.authorize(cardId, { amount: D_AUTH, merchantName: "Rossos-Trattoria", merchantCategoryCode: MCC_ALLOWED });
  const dTxId = dAuth.transactionId || dAuth.id || dAuth.transaction?.id || dAuth.data?.id;
  if (!["authorized", "approved", "settled"].includes(dAuth.status || "") || !dTxId) {
    driftMsg = `auth declined (${dAuth.declinedReason || dAuth.status || "?"}) — can't test drift`;
  } else {
    try { await s.settleTx(dTxId, D_CAP); driftHit = true; driftMsg = "CAPTURE $42.98 ACCEPTED on a $10.00 auth  <- DRIFT (cap gated the auth, not the capture)"; }
    catch (e) { driftMsg = `capture clamped/declined (${e.message.slice(0, 70)}) — Rain re-checks the cap at capture`; }
  }
  console.log("6) CAPTURE-DRIFT auth $10.00 -> capture $42.98:", driftMsg);

  console.log("7) read back:", JSON.stringify(await s.transactions(6)).slice(0, 240));

  // the flip is only meaningful ALONGSIDE the negative control — never let it "pass" alone
  if (flip.settled && !neg.settled)
    console.log("\n>> PROVEN end-to-end: same-MCC wrong-merchant flip settles; out-of-MCC declines. The residual = the whole allowed category — the $-at-risk the gauge prices.");
  else if (flip.settled && neg.settled)
    console.log("\n>> Sandbox is a pass-through recorder (out-of-MCC also 'approved'). The scope claim rests on the card CONTRACT, not the sim — narrate that honestly; do not claim the sim enforced it.");
  else
    console.log("\n>> The flip did not settle — inspect the response and confirm field names/paths against the Playground before scripting the loop.");

  if (driftHit)
    console.log(">> CAPTURE-DRIFT confirmed: the cap gated a $10.00 auth but $42.98 settled at capture. auth != clearing — a SECOND in-policy residual (the capture the cap never re-checks). Verify the moved amount in the read-back before quoting it.");
}

async function main() {
  if (flags.has("--check")) return check();
  if (missing().length) { console.error("missing env — run `node --env-file=.env.local rain.mjs --check`"); process.exit(1); }
  if (flags.has("--demo")) return demo();
  console.log("usage: node --env-file=.env.local rain.mjs [--check | --demo]");
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
