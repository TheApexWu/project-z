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
  console.log("1) fund collateral $1000.00 ..."); await s.fundCollateral(100000);
  console.log("2) issue scoped card, cap $42.99 ..."); const cardId = await s.issueScopedCard(4299); console.log("   cardId:", cardId);
  const fac = s.facilitatorFor(cardId);
  const legit = await fac.settle({ amount: 1500, merchantName: "CloudCompute", merchantCategoryCode: "7372" });
  console.log("3) legit  $15.00 -> CloudCompute:", legit.settled ? `SETTLED (${legit.txId})` : `declined (${legit.reason})`);
  // in-policy flip: under the $42.99 cap, SAME allowed category (MCC 7372), but a WRONG merchant
  const flip = await fac.settle({ amount: 4297, merchantName: "Inference-DECOY", merchantCategoryCode: "7372" });
  console.log("4) FLIP   $42.97 -> wrong merchant, same MCC 7372 (in-policy):", flip.settled ? `SETTLED (${flip.txId})  <- EXPOSURE` : `declined (${flip.reason})`);
  const txns = await s.transactions(5);
  console.log("5) transactions:", JSON.stringify(txns).slice(0, 300));
  console.log(flip.settled
    ? "\n>> The flip SETTLED: the card scoped amount + category but not the exact merchant. That residual is the $-at-risk the gauge prices."
    : "\n>> The flip was DECLINED: this card also binds the exact merchant. Ask Rain what it scopes vs. leaves open — that boundary is our gauge.");
}

async function main() {
  if (flags.has("--check")) return check();
  if (missing().length) { console.error("missing env — run `node --env-file=.env.local rain.mjs --check`"); process.exit(1); }
  if (flags.has("--demo")) return demo();
  console.log("usage: node --env-file=.env.local rain.mjs [--check | --demo]");
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
