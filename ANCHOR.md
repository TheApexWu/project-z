# ANCHOR — known-good manifest (z-draft → project-z)

**`z-draft` = the prep/anchor repo. `project-z` = the official hackathon repo (the Ralph loop runs there).**
This file is the source of truth for the *proven* state. As the loop builds on `project-z`, diff its
output against this — if something drifts, re-apply from the anchor (this scaffold). The loop
**extends** this base; it never rewrites the gauge or the golden.

## Known-good state (verify anytime)
- `node --test` → **48 pass / 0 fail**.
- `node run.mjs` → Avesta ledger head **`e5acaa05382d`**, the **$49.97** in-policy flip past a **$50** cap, the **$19.99** exposure floor. Guarded by `test/golden.test.mjs` (the tripwire — a drift can't hide behind green tests).
- **Zero runtime dependencies** on the default path. Live deps (`viem`) are `optionalDependencies`, lazy-imported only in live mode.

## The seams — interfaces the loop MUST preserve
| Module | Factory | Shape |
|---|---|---|
| `src/x402mock.mjs` | `makeFacilitator({reorgRate, rand})` | `verify(p)`→bool · `settle(p)`→`{settled,reverted,moved}` (seeded/deterministic — the golden path) |
| `src/x402live.mjs` | `makeLiveFacilitator({rpcUrl,privateKey,usdc,facilitatorUrl,maxUsdc})` | same + `txHash`; signs EIP-3009 via viem (Monad track) |
| `src/rainsandbox.mjs` | `makeRainSandbox({apiBase,apiKey,userId,contractId,sessionId})` | `fundCollateral · issueScopedCard · authorize · settleTx · transactions · payment-routes`; `facilitatorFor(cardId)`→`{verify,settle}` (Rain track) |

## Frozen — the loop must not edit these
`src/engine.mjs`, `src/avesta.mjs`, `src/x402mock.mjs`, and all `test/*` except `test/golden.test.mjs`.

## Real constants (verified from the builder PDFs — do NOT invent)
- **Monad:** chain `10143` · RPC `testnet-rpc.monad.xyz` · USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3` · x402 facilitator `x402-facilitator.molandak.org` · `@x402/evm ≥ 2.2.0` (v2). Faucets: `faucet.monad.xyz` (MON), `faucet.circle.com` (USDC).
- **Rain:** API `api-dev.raincards.xyz/v1` · docs `rain-sandbox-trial.mintlify.site` · **sandbox only**. Flow: fund collateral (`rusd`, cents) → issue **scoped card** (`amountInUSDCents`, `sessionid` header) → `authorize` (`{cardId, amount, currency, merchantName, merchantCategoryCode}`) → `settle` → read `transactions` → `payment-routes`.

## Entrypoints
- `node run.mjs` — the gauge (mock, seeded, prints the golden head).
- `node --env-file=.env.local rain.mjs --check | --demo` — Rain sandbox (scoped card → legit buy + in-policy flip → settle).
- `node --env-file=.env.local live.mjs --check | --dry-run | --live` — Monad x402 real settlement.

## Proven now (offline) vs needs creds
- **Proven, no creds:** the gauge (48 tests), the golden tripwire, and both adapters block cleanly (`rain.mjs --check`, `live.mjs --check` write `BLOCKED.md`).
- **Needs creds:** `rain --demo` (RAIN_* keys from the workshop desk), `live --live` (funded Monad testnet wallet + facilitator + `npm i viem`). Secrets live in `.env.local` (gitignored) — never committed, never in a prompt.

## Anchoring check (run against the loop's project-z output)
1. `node --test` still **48 / fail 0**.
2. `node run.mjs` still prints head **`e5acaa05382d`**.
3. The three seam interfaces above are unchanged.
4. The frozen files are byte-identical.
Any mismatch → the loop drifted; re-apply the affected piece from this anchor.
