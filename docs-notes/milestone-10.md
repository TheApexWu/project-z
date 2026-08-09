# Milestone 10

- COMPLETE 2026-08-09. `./scripts/e2e.sh` passed twice back-to-back against the deployed stack (run 1 order `f2b3783f-cde8-498d-9060-c8511384ce2b`, run 2 `20a4475c-dd06-490c-bd60-da7f24a5783e`; ~5m10s each). Both runs used ZERO API fallbacks — the full simulated-human flow ran through the goose agent DM conversations. Demo artifacts in `docs-notes/e2e-run.md` (rewritten on every e2e run; currently holds run 2).

## E2E design (do not re-derive)
- `scripts/e2e.sh` sources `./API_KEYS` and runs `scripts/e2e.mjs` (Node 22, no deps). Env overrides: ORCHESTRATOR_URL, FRONTEND_URL, RAIN_API_BASE.
- Scenario: signed `/begin-order <@A> <@B> $40 McDonald's 3m` in #eats (A=U0BNZQ7KR34, B=U0BPU5GU6KS, share $20 each). A: browse -> suggestion -> over-budget (Big Mac Meal + 20 fries) -> settle -> DM confirm -> modify-after-confirm re-open -> re-confirm. B: lagger (never confirms) -> timer-path GRACE at ~180s -> B adds fries DURING grace. Then MINTING/SUBMITTING/DECLINED_PROOF_CAPTURED/CLOSED at ~300-305s.
- Simulated humans = `chat.postMessage` with the BOT token into the participant DM (bridge.py treats non-self ts as human input). Replies are read via `conversations.history` polling with a per-participant high-water ts; every send/reply is recorded into the transcript in e2e-run.md.
- Order discovery after the slash command: poll `/api/orders` for budget 4000 + COLLECTING + created_at within 2min (idempotent across runs). Announcement discovery: `conversations.history(#eats, oldest=t0)` for text 'Group Grub order'.
- Assertions are hard (26 total): state progression incl. timer-path GRACE entry (>=170s, B unconfirmed), grace modify without deadline extension, carts<=share, total<=$300, Rain card limit == round(1.2*total), decline evidence, past-orders listing, ws cart events, conversational greeting/suggestion/pushback/DM-confirm.
- API fallbacks exist per cart/confirm step (deadline-driven) and are recorded in `fallbacks[]`; a run with fallbacks on the conversational assertions still fails those asserts — fallbacks only keep the state machine moving.
- Pre-run hygiene: refuses to start while another order is active; 30s settle if the last order closed <60s ago (zombie bridges exit within seconds of CLOSED).
- On failure the run cancels the order (best effort) to avoid stray mints, and still writes e2e-run.md with the failure.

## Demo-day pointers
- Latest run: permalink, card id, and full proof JSON are at the top of `docs-notes/e2e-run.md`.
- Past-orders page of the frontend shows both e2e runs CLOSED with proof views.
- To regenerate a fresh demo run: `./scripts/e2e.sh` (needs ./API_KEYS; ~6 min).
