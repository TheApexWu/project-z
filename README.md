# Lantern Order

A group order where several people spend under one hard budget, trade unused sub-budget with
each other, and a checkout agent mints a **Rain scoped card for exactly the final total** once
the group has finished deciding.

> The card did not exist until the group finished deciding, was scoped to exactly what they
> decided, only worked at that merchant, and died on contact.

Built for the Raingentic Commerce Hackathon (Rain × Monad), NYC, August 2026.

## The shape of it

An admin opens an order: a total budget, one merchant, a timer. Everyone gets an equal share by
default. People add items through an agent; anyone who goes over their share can ask the group,
and whoever has slack can give it up — partial fills across several donors are the interesting
case, and the ledger holds the invariant that the group total never exceeds the admin's cap.

When the timer expires the order closes and a checkout agent issues one Rain scoped card for the
exact final total, bound to the merchant's category, and pays. A scripted incident triggers a
partial authorization reversal, and the hold releases to the cent against Rain's own balances.
Settlement fires one Monad transfer per person for their actual post-trade share.

The whole thing renders as a lantern-lit night market: each person is a spirit with a paper
lantern that dims as they spend, budget trades are coins arcing between them, and the scoped
card materializes as a spell card printing its real rules.

Strip the art away and it is delegated spend under a hard guardrail with intra-group
reallocation — the same shape as a departmental budget.

## Running it

```
cp .env.example .env.local        # fill in the Rain sandbox credentials
node --env-file=.env.local preflight.mjs    # prove the rail answers
node --env-file=.env.local drive.mjs --live # the end-to-end run
node server.mjs                              # then open http://localhost:8080
```

The renderer also runs standalone against a canned event stream at
`http://localhost:8080/?demo=1`, with no backend and no credentials.

## Layout

```
shared/events.mjs     the contract between backend and renderer — change this first
src/rain.mjs          Rain sandbox client; every field verified against the live API
src/rainsession.mjs   client-side sessionid generation for scoped-card issuance
src/order.mjs         order state machine, budget ledger, trading
src/checkout.mjs      the finale: issue, decline, authorize, settle
renderer/             the hanami show
verify.mjs            the only gate — nothing is done unless this exits 0
PRD.json / prompt.md  the autonomous build loop's spec and execution guide
```

## A note on what we claim

Rain's scoped card enforces its merchant-category allowlist; it does not enforce its amount at
authorization. So the guardrail we demonstrate is the category decline, which is Rain's own
decision and not one we induced, and the dollar figure on the spell card is the group ledger's
arithmetic. Everything in `evidence/` came off the wire on a real call. Sandbox only.
