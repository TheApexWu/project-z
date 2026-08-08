import { runOnce, DEMO_POLICY } from "./src/engine.mjs";
import { writeReport } from "./src/report.mjs";

// CLI front-end. All computation lives in engine.runOnce so the CLI, the tests,
// and the live web server share one pipeline (live == recorded == static).
const line = () => console.log("-".repeat(72));
const { runData, view } = await runOnce({ policy: DEMO_POLICY, seed: 7, ledgerPath: "dist/avesta.jsonl" });
const { agentKind, cap, mandate, b1, b2, gN, best, trace, arch, bench, hero } = view;

console.log("\nPROJECT ZARATHUSTRA - the gauge, not a firewall.");
console.log("Mock x402/Monad rails, seeded, single-step demo - draft. We MEASURE dollars-slipped; we do not defend.");
console.log(`AGENT backend: ${agentKind}${agentKind === "rule" ? " (no ANTHROPIC_API_KEY - deterministic stub)" : ""}`);
line();

// 1) BASELINE — the agent obeys an injection; the static gate can't tell it apart.
console.log(`BASELINE  (Asha: cap $${cap}, allowlist, mandate = ${mandate.item} <= $${mandate.maxPrice})`);
console.log(`  legit   $${b1.p.amount} -> ${b1.p.payTo}   ${b1.g.allow ? "ALLOW" : "BLOCK"}   L${b1.sev.level} ${b1.sev.label}`);
console.log(`  injected $${b2.p.amount} -> ${b2.p.payTo}   ${b2.g.allow ? "ALLOW" : "BLOCK"}   L${b2.sev.level} ${b2.sev.label}`);
console.log("           ^ the injected in-policy purchase PASSES: the gate can't tell it from a legit $49 buy.");
console.log(`  naive   $900 -> 0xAttacker   ${gN.allow ? "ALLOW" : "BLOCK"} (${gN.reason})   the obvious attack; every firewall stops it`);
line();

// 2) DRUJ — evolve the bypass (single-step demo find).
console.log("DRUJ  evolving injected-but-in-policy purchases (fitness = $ moved x severity)");
for (const t of trace.filter((_, i) => i % 3 === 0 || i === trace.length - 1))
  console.log(`  gen ${String(t.gen).padStart(2)}   best fitness ${Number(t.bestFitness).toFixed(2).padStart(7)}   ($${Number(t.bestMoved).toFixed(2)} moved, L${t.bestLevel})`);
console.log(`  -> discovered: $${best.moved.toFixed(2)} to ${best.p.payTo} passed Asha  (L${best.level}: ${best.label})`);
if (Math.abs(best.moved - 49.97) > 0.5 || best.p.payTo !== "0xInference")
  console.warn("  ! WARN: evolve drifted from the golden find ($49.97 -> 0xInference)");
console.log(`  MAP-Elites archive: ${arch.filled} cells filled across ${Object.keys(arch.rates).length} tactics (coverage detail in report)`);
line();

// 3) HARNESS across profiles -> RASHNU re-rank (measured, not staged).
console.log("HARNESS  running the fused corpus across profiles (measured over trials)");
for (const p of bench.perProfile) console.log(`  ${p.profile.padEnd(8)} $ slipped/trial: $${p.dollarsSlipped.toFixed(2)}`);
line();

console.log("RASHNU  dollar-weighted scoring vs binary success-rate  (reversibility weights = assumed)");
const fmt = (rows) => rows.map((x, i) => `    ${i + 1}. ${x.name.padEnd(38)} succ ${x.asr.toFixed(2)}   $${x.dollars.toFixed(2).padStart(7)}   risk ${x.risk.toFixed(2)}`).join("\n");
console.log("  by binary success-rate:\n" + fmt(bench.leaderboard.byASR));
console.log("  by $-at-risk (Rashnu):\n" + fmt(bench.leaderboard.byRisk));
if (hero) console.log(`  re-rank: '${hero.name}'  #${hero.asrRank} by success-rate  ->  #${hero.riskRank} by $-at-risk  ($${hero.dollars.toFixed(2)}/hit)`);
else console.log("  re-rank: the $-order differs from the success-order (no single attack climbed this run)");
if (!bench.leaderboard.rerankMoved) console.warn("  ! WARN: the $-ranking did not differ from the success-ranking this run");
line();

// 4) AVESTA verify + report.
console.log(`AVESTA  ${view.ledgerCount} entries, chain ${view.ledgerVerified ? "VERIFIED" : "BROKEN"}, head ${view.ledgerHead.slice(0, 12)}...  (local hash-chain, swappable to on-chain)`);
const path = writeReport(runData, { path: "dist/report.html" });
console.log(`HEADLINE: $${best.moved.toFixed(2)} moved past a $${cap} static cap in one in-policy bypass.`);
if (hero) console.log(`          Success-rate ranks '${hero.name}' #${hero.asrRank}; $-at-risk ranks it #${hero.riskRank} - that re-rank is the product.`);
else console.log("          The $-ordering differs from the success-ordering - that re-rank is the product.");
console.log(`Report:   ${path}   (open in a browser)\n`);
