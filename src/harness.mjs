import { makeAsha } from "./asha.mjs";
import { makeFacilitator } from "./x402mock.mjs";
import { rng } from "./rng.mjs";
import { score } from "./rashnu.mjs";

// The benchmark harness (the moat). Runs every corpus attack against every policy
// profile N trials on the mock rail, MEASURES asr + dollars-moved from the actual
// runs, weights by an ASSUMED reversibility, and hands empirical rows to
// rashnu.score(). The re-rank (biggest-$ attack ranked last by success-rate,
// first by $-at-risk) is COMPUTED from those measured rows, never staged.

function hashSeed(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function runBenchmark({ corpus, profiles, profileOrder, mandate, trials = 200, seed = 1, reorgRate = 0.2 }) {
  const cells = [];
  const perProfileMoved = Object.fromEntries(profileOrder.map((p) => [p, 0]));

  for (const attack of corpus) {
    for (const profileName of profileOrder) {
      const policy = profiles[profileName];
      let hits = 0;
      let movedSum = 0;
      for (let t = 0; t < trials; t++) {
        const fac = makeFacilitator({ reorgRate, rand: rng(hashSeed(`${seed}|${attack.id}|${profileName}|${t}`)) });
        const freshAsha = () => makeAsha(policy);
        const o = attack.run({ freshAsha, facilitator: fac, mandate, profile: policy });
        if (o.hit) {
          hits++;
          movedSum += o.moved;
        }
      }
      cells.push({
        attackId: attack.id,
        attackName: attack.name,
        layer: attack.layer,
        vector: attack.vector,
        profile: profileName,
        trials,
        successes: hits,
        asr: hits / trials,
        movedTotal: movedSum,
      });
      perProfileMoved[profileName] += movedSum / trials;
    }
  }

  // aggregate per attack across profiles
  const rows = corpus.map((attack) => {
    const cc = cells.filter((c) => c.attackId === attack.id);
    const totalTrials = cc.reduce((s, c) => s + c.trials, 0);
    const totalHits = cc.reduce((s, c) => s + c.successes, 0);
    const movedAll = cc.reduce((s, c) => s + c.movedTotal, 0);
    return {
      name: attack.name,
      id: attack.id,
      layer: attack.layer,
      vector: attack.vector,
      asr: totalHits / totalTrials,
      dollars: totalHits ? movedAll / totalHits : 0,
      reversibility: attack.reversibility,
    };
  });

  const scored = score(rows.map((r) => ({ name: r.name, success: r.asr, moved: r.dollars, reversibility: r.reversibility })));
  const asrOrder = scored.byASR.map((r) => r.name);
  const riskOrder = scored.byRisk.map((r) => r.name);
  const rankIn = (order, name) => order.indexOf(name) + 1;
  // hero = the attack that climbs the most moving from success-rate to $-at-risk
  let hero = null;
  let bestDelta = -Infinity;
  for (const r of scored.byRisk) {
    const a = rankIn(asrOrder, r.name);
    const k = rankIn(riskOrder, r.name);
    if (a - k > bestDelta) {
      bestDelta = a - k;
      hero = { name: r.name, asrRank: a, riskRank: k, dollars: r.dollars, asr: r.asr };
    }
  }
  if (bestDelta <= 0) hero = null; // only claim a "climb" when one genuinely happened
  const leaderboard = {
    byASR: scored.byASR,
    byRisk: scored.byRisk,
    totalAtRisk: scored.totalAtRisk,
    topByASR: scored.byASR[0],
    topByRisk: scored.byRisk[0],
    rerankMoved: JSON.stringify(asrOrder) !== JSON.stringify(riskOrder),
    hero,
  };

  const perProfile = profileOrder.map((p) => ({ profile: p, dollarsSlipped: +perProfileMoved[p].toFixed(2) }));
  return { leaderboard, perProfile, cells, meta: { trials, seed, reorgRate } };
}
