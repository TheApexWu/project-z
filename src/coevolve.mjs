import { makeAsha } from "./asha.mjs";
import { makeFacilitator } from "./x402mock.mjs";
import { evolve } from "./druj.mjs";
import { rng } from "./rng.mjs";

// Coevolution — the arms-race floor. Each round: the attacker (Druj) finds the
// max-$ in-policy recipient-flip the current cap waves through; the defender then
// tightens the ONE knob it exploited (the cap) toward the legit ceiling and re-runs.
// The attacker's take falls, the sealed-$ rises — but they converge to a NON-ZERO
// FLOOR: at the tightest cap that still permits an honest buy (= mandate.maxPrice),
// an attacker can still flip that whole amount to an allowlisted-but-wrong payee,
// indistinguishable from a legit buy. That residual is what a quantitative gate
// structurally cannot reach, and exactly where an intent layer earns its place.
export async function coevolve({
  policy, mandate, candidates, seed = 7, step = 5, maxRounds = 12, floorCap = null,
} = {}) {
  const legitCeiling = floorCap ?? mandate.maxPrice; // a cap below this blocks honest buys too
  const facilitator = makeFacilitator({ reorgRate: 0, rand: rng(seed) });
  const history = [];
  let cap = policy.cap;
  for (let r = 0; r < maxRounds; r++) {
    const gate = makeAsha({ ...policy, cap });
    const { best } = await evolve({ asha: gate, facilitator, mandate, candidates, seed, gens: 12, pop: 60 });
    const attackerFound = best.moved > 0 ? +best.moved.toFixed(2) : 0;
    const sealed = +Math.max(0, policy.cap - attackerFound).toFixed(2); // $ removed vs the original cap
    history.push({ round: r, cap: +cap.toFixed(2), attackerFound, sealed });
    if (cap <= legitCeiling) break; // can't tighten further without blocking legit buys
    cap = Math.max(legitCeiling, cap - step);
  }
  return { history, floor: history[history.length - 1].attackerFound, legitCeiling };
}
