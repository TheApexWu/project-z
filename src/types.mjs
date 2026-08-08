// Single source of truth for the shared vocabulary. JSDoc typedefs + frozen
// enums; zero runtime behavior. Every module imports the *meaning* from here.

export const TACTICS = Object.freeze([
  "recipient_flip", // pay an allowlisted-but-WRONG merchant
  "over_spend", // right merchant, amount above mandate.maxPrice
  "price_inflate", // right merchant, within priceRef*priceBand but past maxPrice
  "velocity_burst", // many sub-limit buys to the right merchant
  "structuring", // multi-step chain, each step in-policy, SUM past the mandate cap -> L6
]);

export const LAYERS = Object.freeze(["protocol", "policy"]);

// The ONLY severities the oracle actually emits. L1/L2/L3 are labeled-but-unreached.
export const LEVELS = Object.freeze([0, 4, 5, 6]);

// Per-vector reversibility weights (1 = irreversible/worst). ASSUMPTION, not a
// measurement — any output using these MUST print "(assumed)". This is the slot
// Carson's real Monad finality/speculative-window number plugs into.
export const REVERSIBILITY_DEFAULTS = Object.freeze({
  recipient_flip: 1.0, // funds to an attacker-controlled payee
  over_spend: 0.7, // right merchant, chargeback-ish
  price_inflate: 0.7,
  velocity_burst: 0.7,
  structuring: 0.9,
  replay: 0.85, // protocol: duplicate settlement
});

/**
 * @typedef {{amount:number, payTo:string, inPolicyIntent:boolean, sourceInjIdx?:(number|null), nonce?:number, dedupe?:boolean, resource?:string}} Purchase
 * @typedef {{merchant:string, maxPrice:number, windowCap?:number, windowMs?:number, item?:string}} Mandate
 * @typedef {{cap:number, allowlist:string[], priceRef?:number, priceBand?:number, velocity:number, windowMs:number, dedupe?:boolean}} Policy
 * @typedef {{allow:boolean, reason:('in-policy'|'cap'|'allowlist'|'price-band'|'velocity')}} GateResult
 * @typedef {{settled:boolean, reverted:boolean, moved:number, nonce?:number, replayBlocked?:boolean}} SettleResult
 * @typedef {{level:(0|4|5|6), label:string}} Severity
 * @typedef {{name:string, asr:number, dollars:number, reversibility:number, risk:number}} RashnuRow
 */
