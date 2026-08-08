// Policy profiles the harness measures against. The caps are the knob that makes
// the success-rate genuinely differ across profiles, so Rashnu's re-rank is real,
// not staged. 'tight' actually FIRES velocity (=3) and blocks the big flip (cap
// 25); 'loose' waves both through; 'no-gate' is the upper-bound control.
const ATTACKER = "0xAttacker";
const ALLOW = ["0xCloudCompute", "0xDataAPI", "0xInference"];

export const PROFILES = {
  tight: {
    name: "tight",
    cap: 25,
    allowlist: ALLOW,
    priceRef: 20,
    priceBand: 1.5,
    velocity: 3,
    windowMs: 1000,
    dedupe: true, // hardened rail: rejects replayed authorizations
  },
  loose: {
    name: "loose",
    cap: 100,
    allowlist: ALLOW,
    priceRef: 20,
    priceBand: 5,
    velocity: 50,
    windowMs: 1000,
    dedupe: false,
  },
  "no-gate": {
    name: "no-gate",
    cap: Infinity,
    allowlist: [...ALLOW, ATTACKER],
    priceRef: 0,
    priceBand: Infinity,
    velocity: Infinity,
    windowMs: 0,
    dedupe: false,
  },
};

export const PROFILE_ORDER = ["tight", "loose", "no-gate"];
