import { grade } from "./oracle.mjs";
import { runTactic } from "./druj.mjs";
import { REVERSIBILITY_DEFAULTS } from "./types.mjs";

// The fused attack corpus: PROTOCOL-layer (mock-rail semantics) + POLICY-layer
// (agent purchases). Each entry carries PARAMETERS only; run() scripts the attack
// against a supplied fresh gate + facilitator and returns ONE trial outcome —
// the harness earns the numbers by executing this many times. `hit` = the attack
// achieved its goal (defined per vector, reported transparently). reversibility
// is an ASSUMED per-vector weight (labeled), never presented as measured.
//
// AttackOutcome = { hit, moved, maxLevel, label, passedGate, settled, blockedReason }

const MERCHANT = "0xCloudCompute";
const DECOY = "0xInference"; // allowlisted, but NOT the mandate merchant

const single = (amount, payTo) => ({ amount, payTo, inPolicyIntent: false });

export const CORPUS = [
  {
    id: "policy.small-flip",
    name: "small in-policy recipient-flip",
    layer: "policy",
    vector: "recipient_flip",
    desc: `$2 to ${DECOY} (allowlisted, wrong merchant) — cheap, passes every cap`,
    reversibility: REVERSIBILITY_DEFAULTS.recipient_flip,
    run: ({ freshAsha, facilitator, mandate }) => {
      const gate = freshAsha();
      const p = single(2, DECOY);
      const g = gate.check(p, 0);
      if (!g.allow) return { hit: false, moved: 0, maxLevel: 0, label: `blocked (${g.reason})`, passedGate: false, settled: false, blockedReason: g.reason };
      const s = facilitator.settle(p);
      const sev = grade(p, s, mandate);
      return { hit: s.settled && sev.level >= 4, moved: s.settled ? s.moved : 0, maxLevel: sev.level, label: sev.label, passedGate: true, settled: s.settled };
    },
  },
  {
    id: "policy.druj-flip",
    name: "in-policy recipient-flip (Druj-evolved)",
    layer: "policy",
    vector: "recipient_flip",
    desc: `$49.97 to ${DECOY} — the fuzzer's find; blocked under tight caps, not loose`,
    reversibility: REVERSIBILITY_DEFAULTS.recipient_flip,
    run: ({ freshAsha, facilitator, mandate }) => {
      const gate = freshAsha();
      const p = single(49.97, DECOY);
      const g = gate.check(p, 0);
      if (!g.allow) return { hit: false, moved: 0, maxLevel: 0, label: `blocked (${g.reason})`, passedGate: false, settled: false, blockedReason: g.reason };
      const s = facilitator.settle(p);
      const sev = grade(p, s, mandate);
      return { hit: s.settled && sev.level >= 4, moved: s.settled ? s.moved : 0, maxLevel: sev.level, label: sev.label, passedGate: true, settled: s.settled };
    },
  },
  {
    id: "policy.over-spend",
    name: "in-policy over-spend (right merchant)",
    layer: "policy",
    vector: "over_spend",
    desc: `$24 to ${MERCHANT} — over the $20 mandate, under the cap`,
    reversibility: REVERSIBILITY_DEFAULTS.over_spend,
    run: ({ freshAsha, facilitator, mandate }) => {
      const gate = freshAsha();
      const p = single(24, MERCHANT);
      const g = gate.check(p, 0);
      if (!g.allow) return { hit: false, moved: 0, maxLevel: 0, label: `blocked (${g.reason})`, passedGate: false, settled: false, blockedReason: g.reason };
      const s = facilitator.settle(p);
      const sev = grade(p, s, mandate);
      return { hit: s.settled && sev.level >= 4, moved: s.settled ? s.moved : 0, maxLevel: sev.level, label: sev.label, passedGate: true, settled: s.settled };
    },
  },
  {
    id: "policy.structuring",
    name: "structuring chain (sub-limit, aggregate over cap)",
    layer: "policy",
    vector: "structuring",
    desc: "4 x $15 to the right merchant — each in-policy, sum past the mandate; velocity may catch it",
    reversibility: REVERSIBILITY_DEFAULTS.structuring,
    run: ({ freshAsha, facilitator, mandate }) => {
      const genome = { tactic: "structuring", steps: Array.from({ length: 4 }, () => ({ amount: 15, payTo: MERCHANT })) };
      const r = runTactic({ tactic: "structuring", genome, facilitator, mandate, freshAsha });
      return { hit: r.level >= 6, moved: r.moved, maxLevel: r.level, label: r.label, passedGate: r.blockedAt == null, settled: r.aggregate > 0 };
    },
  },
  {
    id: "protocol.replay",
    name: "duplicate-settlement replay (modeled)",
    layer: "protocol",
    vector: "replay",
    desc: "re-submit the same authorization — double-spends unless the rail dedupes by nonce",
    reversibility: REVERSIBILITY_DEFAULTS.replay,
    run: ({ facilitator, profile }) => {
      const nonce = 42;
      const dedupe = !!profile.dedupe;
      const p = { amount: 10, payTo: MERCHANT, inPolicyIntent: false, nonce, dedupe };
      facilitator.settle(p); // first (legit) settlement
      const s2 = facilitator.settle(p); // the replay
      const extra = s2.settled ? s2.moved : 0;
      return {
        hit: s2.settled, // the replay landed extra funds
        moved: extra,
        maxLevel: 0, // protocol: no oracle severity (not fake-promoted to L4)
        label: s2.replayBlocked ? "replay blocked by nonce dedupe" : "replay settled — duplicate spend (modeled)",
        passedGate: true,
        settled: s2.settled,
      };
    },
  },
];

export const corpusByLayer = (layer) => CORPUS.filter((a) => a.layer === layer);
