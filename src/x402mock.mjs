// Mock x402 facilitator + settlement. settle() FOLDS the off-chain verify and the
// settle-window revert into one modeled outcome: it can revert in the speculative
// window (Monad ~400ms) before deterministic finality (~800ms). verify() is a stub
// seam, not wired into the flow. MOCK, not a measurement — swap for the real @x402
// facilitator later.
//
// Optional nonce guard: engages ONLY when p.nonce is set. p.dedupe=true MODELS the
// contract-level EIP-3009 nonce guard (mandatory on a real token; here a benchmark
// knob to score a compliant rail vs an omitted one). Stateless path is byte-identical.
export function makeFacilitator({ reorgRate = 0, rand = Math.random } = {}) {
  const used = new Set();
  return {
    verify: (p) => p.amount > 0 && !!p.payTo,
    settle: (p) => {
      if (p.nonce !== undefined && p.dedupe && used.has(p.nonce))
        return { settled: false, reverted: false, moved: 0, nonce: p.nonce, replayBlocked: true };
      const reverted = rand() < reorgRate;
      // EIP-3009 semantics: authorizationState is written only by a SUCCESSFUL transfer —
      // a reverted settlement consumes no nonce, so a legitimate retry must be allowed.
      if (p.nonce !== undefined && p.dedupe && !reverted) used.add(p.nonce);
      const out = { settled: !reverted, reverted, moved: reverted ? 0 : p.amount };
      if (p.nonce !== undefined) out.nonce = p.nonce;
      return out;
    },
  };
}
