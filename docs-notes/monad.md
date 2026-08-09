# Monad / x402 narrative (milestone 7)

## What exists now
- Every minted order persists `orders.collateral_contract_id` (from `COLLATERAL_CONTRACT_ID`) and `orders.collateral_chain` (from env `COLLATERAL_CHAIN`, empty until Rain discloses it — the sandbox API has NO collateral-contract GET endpoint; checked the full OpenAPI spec 2026-08-09).
- Rain scoped cards draw against an on-chain collateral contract (rUSD). Card spend settles against that contract, so every group order is ultimately backed by an on-chain balance — that is the Monad-bounty hook: Rain collateral contracts are the settlement layer; our orchestrator mints a purpose-scoped card per order with agent-control-layer rules (amount cap, MCC allowlist, expiry).
- `POST /v1/simulate/collateral/fund` accepts our `COLLATERAL_CONTRACT_ID` (returned `{"success":true}` for a 100-cent probe). Supported sandbox chains per docs: Ethereum Sepolia, Avalanche Fuji, Solana Devnet, Polygon Amoy, Base Sepolia. The collateral tx did NOT appear in `GET /v1/issuing/transactions` within minutes — the listener pipeline is async; do not rely on reading it back.
- The order detail endpoint (`GET /internal/orders/{id}`) now returns `rain_card_id`, `collateral_contract_id`, `collateral_chain` so the milestone 9 UI can render the linkage.

## Ideas for the next loop (if time allows)
1. **x402 payment header flow**: x402 (docs.x402.org) is an HTTP 402 payment-required scheme where a client pays in stablecoin (e.g. USDC on Monad testnet) and retries with a payment proof header. Angle: the orchestrator's internal agent tools (`/internal/orders/.../cart`) could REQUIRE an x402-style payment authorization header carrying the Rain card id — demonstrating machine-native payment negotiation between agent and orchestrator. Keep it as a thin middleware that logs the header; do not gate real flow on it.
2. **Foundry receipt contract on Monad testnet**: deploy a tiny `OrderReceipt` contract (getfoundry.sh toolchain) that the SUBMITTING handler calls to emit an on-chain receipt event (order id hash, total, decline flag). Monad testnet RPC + a burned demo key would be needed; store the tx hash in `card_attempts.rain_response.receipt_tx`.
3. **Demo framing**: "Rain's agent control layer bounds what the ordering agents can spend; the collateral contract settles on-chain; Monad is the high-throughput settlement rail this class of agentic commerce wants." The decline-proof page then shows BOTH the card rules (Web2 enforcement) and the collateral linkage (on-chain backing).

## Constraints discovered
- No Rain endpoint returns contract chain/address/explorer link. If judges ask, the linkage is the contract id itself plus Rain's docs.
- Do NOT call `simulate/collateral/fund` per order: funding is tenant-level, not per-card, and the sandbox balance is shared.
