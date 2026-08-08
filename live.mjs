// live.mjs — OPT-IN real Monad settlement. The default path and ALL tests NEVER run this.
// Usage: node live.mjs [--check | --dry-run | --live]   (a real send requires ZARA_LIVE=1)
import { makeLiveFacilitator } from "./src/x402live.mjs";

const flags = new Set(process.argv.slice(2));
const NEED = ["MONAD_RPC", "MONAD_PRIVATE_KEY", "USDC_ADDR", "FACILITATOR_URL"];
const missing = () => NEED.filter((k) => !process.env[k]);

// the demo purchase: an in-policy amount to an allowlisted-but-wrong testnet recipient
const demo = { amount: Number(process.env.DEMO_AMOUNT || "0.01"), payTo: process.env.DEMO_PAYTO || "" };

// milestone 0: preflight. Runs offline; reports every missing prereq and writes BLOCKED.md.
async function check() {
  const miss = missing();
  const viemOk = await import("viem").then(() => true).catch(() => false);
  console.log("LIVE preflight (milestone 0):");
  NEED.forEach((k) => console.log(`  [${process.env[k] ? "OK " : "MISSING"}] ${k}`));
  console.log(`  [${viemOk ? "OK " : "MISSING"}] viem  (npm i viem — optionalDependency, live only)`);
  console.log(`  ZARA_LIVE=${process.env.ZARA_LIVE || "(unset)"}`);
  const blockers = [...miss, viemOk ? null : "viem"].filter(Boolean);
  if (blockers.length) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      "BLOCKED.md",
      `# BLOCKED — live settlement cannot start\n\nMissing: ${blockers.join(", ")}\n\n` +
        "Provide these (env vars / `npm i viem`) and re-run `node live.mjs --check`.\n" +
        "Do NOT proceed to live mode until this is clean; do NOT fake a settlement.\n"
    );
    console.log(`\nBLOCKED — missing: ${blockers.join(", ")}. Wrote BLOCKED.md. Not proceeding.`);
    process.exit(1);
  }
  console.log("\npreflight OK — ready for --dry-run.");
}

function facilitator() {
  return makeLiveFacilitator({
    rpcUrl: process.env.MONAD_RPC,
    privateKey: process.env.MONAD_PRIVATE_KEY,
    usdc: process.env.USDC_ADDR,
    facilitatorUrl: process.env.FACILITATOR_URL,
    maxUsdc: Number(process.env.MAX_TEST_USDC || "1"),
    chainId: 10143,
  });
}

async function main() {
  if (flags.has("--check")) return check();
  if (missing().length) { console.error("missing env:", missing().join(", "), "— run `node live.mjs --check`"); process.exit(1); }
  if (!demo.payTo) { console.error("set DEMO_PAYTO (an allowlisted-but-wrong testnet recipient — the in-policy flip)"); process.exit(1); }
  const f = facilitator();

  if (flags.has("--dry-run")) { console.log("DRY RUN (no tx sent):", await f.dryRun(demo)); return; }

  if (flags.has("--live")) {
    if (process.env.ZARA_LIVE !== "1") { console.error("refusing: set ZARA_LIVE=1 to send ONE real testnet settlement"); process.exit(1); }
    console.log("preflight:", await f.preflight());
    const t0 = performance.now();
    const r = await f.settle(demo);
    const wallClockMs = +(performance.now() - t0).toFixed(1);
    console.log("settle:", r);
    if (!r.settled) { console.error("settlement not confirmed on-chain — NOT recording a finality number"); process.exit(1); }
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync("dist", { recursive: true });
    // NOTE: wallClockMs is time-to-first-receipt, a PLACEHOLDER. The real reversibility input is
    // Monad's speculative-vs-final settlement window — measure that with Monad's help on Day-1
    // and put it in measuredWindowMs.
    writeFileSync("dist/finality.json", JSON.stringify({
      txHash: r.txHash, block: r.blockNumber, wallClockMs, measuredWindowMs: null,
      at: new Date().toISOString(),
      note: "PLACEHOLDER wall-clock; replace measuredWindowMs with the speculative-vs-final gap (Day-1 Monad).",
    }, null, 2));
    console.log("wrote dist/finality.json — replace measuredWindowMs with the real gap, then wire into reversibility.");
    return;
  }

  console.log("usage: node live.mjs [--check | --dry-run | --live]   (a real send requires ZARA_LIVE=1)");
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
