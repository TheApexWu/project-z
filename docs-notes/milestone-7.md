# Milestone 7

- COMPLETE 2026-08-09. Two test orders minted real Rain scoped cards: order A `e7d11a09-4b98-4f7c-aa79-f6d3f1032c4d` (total 938¢) → card `c67dcbdd-8e1f-4c93-a681-2949096cd7a1` limit 1126 (=1.2×938); order B `7e133227-2504-436e-90af-5d3c1a339995` (same total, rules changed to `amountCapCents:500` + `allowedMccs:["5812"]`) → card `76831931-6e68-44e3-bb3d-41bea8f1eff1` limit 600. Both visible in `GET /v1/issuing/cards`; both orders now rest in SUBMITTING with live cards — milestone 8's SUBMITTING handler can use them as fixtures.

## Architecture (do not re-derive)
- `server/rain.go`: Rain client. Session id = 16 random bytes → hex secret; base64(raw bytes) RSA-OAEP-**sha1** encrypted with the sandbox public key (PEM inlined) → base64. `createScopedCard` retries once on network/5xx only (4xx is final); every attempt is recorded in `card_attempts.rain_response.attempts[]` with status+body.
- Minting is a sweep inside the 1s tick: `state=MINTING AND NOT EXISTS card_attempts` → claim by synchronous `INSERT INTO card_attempts` (prevents double-mint across ticks), then `mintOrder` runs async. Success → SUBMITTING + `orders.collateral_contract_id`; failure → FAILED (new state, migration 004) with evidence.
- `card_attempts.amount_cents` records the TRUE order total; the Rain request amount may be lower when `amountCapCents` rule applies. The DB CHECK on amount_cents was relaxed to `>= 0` so over-cap evidence is recordable; the $300 cap is Go-enforced at create/cart/mint.
- Admin rules (`settings.rain_client_rules` JSONB): `allowedMccs` (absent→default 5411/5812/5814, explicit `[]`→no restriction), `expiresInDays` (0→omit), `amountCapCents` (0→order total). Defaults in `defaultRainRules()`.
- `GET/PUT /api/settings` with basic auth carson/1234 (orchestrator-enforced). `GET /internal/orders/{id}` now returns `rain_card_id`, `collateral_contract_id`, `collateral_chain`.

## Hard-won facts
- Rain card objects do NOT expose `allowedMccs` or scoped `expiresAt`; `expirationMonth/Year` are random embossed values. The ONLY rule-driven field visible on the card object is `limit.amount` (=1.2×requested, rounded) — hence the `amountCapCents` rule exists to prove rule changes observably.
- `POST /v1/simulate/collateral/fund` returns `{"success":true}` (no tx id); collateral txs did not appear in `/v1/issuing/transactions` within minutes. No API exposes the collateral contract's chain/address — `COLLATERAL_CHAIN` env stays empty; see `docs-notes/monad.md`.
- Sandbox user is shared ("Team31"): expect other teams' cards/txs in list endpoints; always filter by our own card ids.
- `.dockerignore` added (API_KEYS etc. were previously uploaded in the build context; final image never contained them).
- Settings were RESET after verification to `{"allowedMccs":["5411","5812","5814"],"expiresInDays":30}` + delivery address `1 Hackathon Way, San Francisco, CA 94105`.
- psql via `docker run --rm postgres:16-alpine psql "$(railway variables --service Postgres --kv | grep ^DATABASE_URL= | cut -d= -f2- | sed 's|@[^/]*/|@shortline.proxy.rlwy.net:22769/|')"` (TCP proxy still up).
