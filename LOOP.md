# LOOP.md — memory across Ralph iterations

Append only. Never rewrite an earlier entry. The next iteration of you reads this to avoid
repeating a dead end.

---

## Seed entry — 2026-08-08, before the loop starts

The project pivoted tonight. It used to be a dollar-weighted exposure gauge for agent payments
("Zarathustra"). That was killed because measuring a control is QA, not a product, and none of
Rain's four submission categories is security or measurement. The gauge modules were deleted;
they live in git history and in the private z-draft repo if anything is ever needed back.

What replaced it is Lantern Order. Read PRD.json, especially `theOneScenario` — build toward
that exact run, not toward a general system.

### API facts learned the hard way tonight, so you do not have to relearn them

- `sessionid` for scoped-card issuance is NOT desk-issued. It is client-generated RSA-OAEP.
  `src/rainsession.mjs` does it. This blocked the whole project for a while; it is solved.
- A scoped card enforces its MCC allowlist and does NOT enforce its amount. Verified: a card
  requested at 7340 cents authorized 8809. The MCC decline is the only Rain-enforced boundary
  we have, so it is the guardrail beat.
- A scoped card is consumed by a SUCCESSFUL authorization (status flips to `canceled`) but
  survives a DECLINE. Order the beats accordingly: decline first, real charge last.
- A plain card with `frequency: "perAuthorization"` DOES enforce its amount exactly. Verified
  in M0: $5.00 authorized, $5.01 declined `card_spending_limit_exceeded`.
- `settle` requires `{amount}` in the body. An empty body 400s.
- `GET /issuing/contracts` is 403 on this tenant. Payment-route transfers never reach a
  terminal state (observed stuck in `processing` for 890s+). Both are dead ends — do not
  build on them, and do not spend an iteration rediscovering this.
- The sandbox account is SHARED with other hackathon teams. `GET /issuing/transactions`
  contains strangers' rows. Filter by your own cardIds before displaying anything.

### Status at seed time

M0 is already PASS — `preflight.mjs` ran live and wrote `evidence/M0.json`. Use it as the
worked example of what an evidence file looks like: real uuids, real balances before and
after, `forcedDecline: false`.

Start at M1.
