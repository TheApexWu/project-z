# Project Zarathustra

**The gauge, not a firewall.** A dollar-weighted exposure gauge for agent payments: it measures, in dollars, how much a prompt-injected AI agent can spend while staying *inside* its spend policy — the residual that caps and allowlists can't see, because it's in-policy.

Built on **Rain** (scoped agent cards) and **Monad** (x402 settlement). It doesn't block the agent economy; it prices its risk, so the controls that already ship know how much is exposed.

## The idea
A scoped card blocks the obvious attack — a large charge to a stranger, over the cap, off the allowlist. It can't tell a legitimate $42 purchase from a prompt-injected $42 purchase to a *different merchant in the same allowed category*. That in-policy flip is invisible to a static control because it *is* in-policy. Zarathustra measures it:

- a **policy gate** — the baseline: a Rain-style scoped card (amount + merchant-category + expiry);
- an **evolutionary fuzzer** that finds the maximum-dollar in-policy bypass a gate waves through;
- a **scorer** that ranks by `dollars-at-risk = frequency × dollars × reversibility` — FAIR / event-based "Cyber-VaR" — surfacing the rare-but-costly attack that binary success-rate benchmarks bury;
- a tamper-evident **ledger** of every verdict.

Tighten the cap and the attacker's take falls, but it converges to a **non-zero floor** — the residual a static rule can't close without also blocking honest buys — which is exactly where an intent-aware layer earns its place.

## Two rails
- **Rain — card sandbox** (`rain.mjs`, `src/rainsandbox.mjs`): issue a scoped agent card, run `authorize` → `settle`, and measure the in-policy flip on Rain's real sandbox API. Agents actually move money.
- **Monad — x402** (`live.mjs`, `src/x402live.mjs`): settle a stablecoin payment on Monad testnet via EIP-3009, and measure the speculative-vs-final settlement window — the *reversibility* term, grounded in a real Monad number.

## Run
```
node run.mjs      # the gauge — seeded, deterministic; prints the exposure figures
node --test       # 48 tests, zero runtime dependencies
```
Live rails are opt-in and read credentials from a local, gitignored `.env.local`:
```
node --env-file=.env.local rain.mjs --check    # Rain sandbox preflight
node --env-file=.env.local rain.mjs --demo     # scoped card -> authorize/settle -> the in-policy flip
node --env-file=.env.local live.mjs --check    # Monad x402 preflight
```

## Requirements
`PRD.json` holds the requirements and milestones for both rails, each with an exact verify command. The offline gauge is complete and deterministic (two runs reproduce the same ledger head); the live rails are wired against Rain's sandbox and Monad's testnet and block cleanly until credentials are provided. **Sandbox / testnet only — no real money moves.**
