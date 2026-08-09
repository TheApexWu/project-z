# Milestone 8

- COMPLETE 2026-08-09. Three orders CLOSED with DoorDash sandbox delivery ids + Rain decline evidence: fixtures `e7d11a09`/`7e133227` (from milestone 7) and full Slack-flow order `8a2ba264-2f75-411e-9b67-791415ee9afc` (card `f09507ba-be09-414d-b7d6-54f842870db0`, delivery `gg-8a2ba264-2f75-411e-9b67-791415ee9afc`).

## Architecture (do not re-derive)
- `server/doordash.go`: Drive client. JWT per call (HS256, `dd-ver: DD-JWT-V1`, base64url-decoded secret, 5-min exp). `submitDelivery` = POST `/drive/v2/quotes` then POST `/drive/v2/quotes/{id}/accept`. Retries: once on network/5xx; on 422 `distance_too_long` it retries with `doordashFallbackPickupAddress` (901 Market St SF — the DoorDash tutorial address, always serviceable in sandbox) because the CSV restaurant addresses are in Houston and the sandbox enforces real distance rules. All attempts recorded.
- Payment leg: Drive sandbox takes NO card payment, so `rainClient.simulateAuthorization` POSTs `/v1/simulate/transactions/authorize` with `declineReason: account_credit_limit_exceeded` — REQUIRED: a plain authorize against an in-limit scoped card returns `authorized` (verified empirically), which would break the declined-by-design narrative. `payment_path` column records `rain_simulated_authorization`.
- SUBMITTING sweep in `tick` (`submitOutstanding`): LATERAL join for latest card_attempt with a card; claim = `UPDATE ... SET doordash_request='{"claimed_at":...}' WHERE doordash_request='{}'` (RowsAffected==1 wins). `submitOrder` records evidence after EACH leg, then SUBMITTING → DECLINED_PROOF_CAPTURED → CLOSED. Permanent failure → FAILED with evidence (direct UPDATE, same pattern as mintOrder).
- Migration 005: `card_attempts.doordash_delivery_id`, `payment_path`.
- `GET /api/orders/{id}/proof` (`server/proof.go`): unauthenticated showcase endpoint; order + latest card_attempt (rain/doordash request+response, delivery id, payment path, declined_at) + participants/carts + total.
- Announcement (`announcementBlocks`): deadline shown only for OPEN/COLLECTING/GRACE; status detail line per later state; the CLOSED/DECLINED_PROOF_CAPTURED line includes the proof URL from `ORCHESTRATOR_PUBLIC_URL`.

## Hard-won facts
- DoorDash sandbox = same host `openapi.doordash.com`; our access key is sandbox-only so all deliveries are simulated. Quote needs pickup+dropoff near each other (422 `distance_too_long` otherwise). `external_delivery_id` = `gg-<order uuid>`; GET delivery by that id works.
- Rain simulate authorize: `POST /v1/simulate/transactions/authorize`, auth = `Api-Key` header ONLY (no sessionid). 404 would mean simulation not enabled for tenant (it is). Decline response: `{transactionId, status:"declined", declinedReason}`.
- SQL footgun that cost one deploy: a LATERAL subquery must list every column the outer query references (`ca.doordash_request` was missing → `column does not exist` every tick). Fixed.
- Agent jobs self-complete ~2m after the order closes (observed Complete 1/1); no cleanup needed.
- Empty-cart orders would mint a 0-cent card and the Rain authorize would 400 (amount min 1) — always add cart items before grace ends in tests.
