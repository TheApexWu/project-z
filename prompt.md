# Lantern Order — Ralph loop: how to execute

You are an autonomous coding agent working on this repo. `PRD.json` is WHAT to build; this file
is HOW to execute. Read both every iteration. No human reads your comments or your commit
messages in real time, so write them for the next iteration of yourself.

## The loop, one iteration

1. Read `PRD.json` and `LOOP.md`. `LOOP.md` is your memory across iterations — what you tried,
   what failed, what you learned about the API. Append to it; never rewrite history.
2. Run `node verify.mjs status`. Pick the LOWEST-numbered milestone that is not yet passing and
   whose `dependsOn` are all passing. Work only on that one.
3. Build it. Write the evidence file the milestone requires under `evidence/<ID>.json`.
4. Run `node verify.mjs <ID>`. If it exits non-zero, fix and retry.
5. Run `node verify.mjs gate`. This must exit 0 before you commit.
6. Commit and push. One commit per iteration, message `<ID>: <what changed>`.
7. Append a short entry to `LOOP.md`: milestone, what you did, what surprised you.

Push after every single commit. The humans are watching the repo, not your terminal.

## Hard rules

**Never fabricate evidence.** Every id, hash, last4, transaction id, and dollar figure in an
evidence file must have come back off the wire from a real API call in that same run. `verify.mjs`
rejects obvious placeholders, but the rule is broader than what it can catch: if you did not
observe it, you may not write it down. A milestone honestly marked blocked is worth more than a
milestone dishonestly marked done — the humans are pitching this to the people who built the API.

**Never force a decline.** The Rain authorize endpoint accepts an optional `declineReason` that
makes it return a decline you asked for. Passing it and then presenting the result as Rain
enforcing a rule is fabrication. The MCC decline in M3 must come from Rain's own logic with no
`declineReason` in the request body.

**Ration scoped cards.** Documented limits are 10 active and 10 created per user per rolling 24
hours. Do all exploratory work with `issuePlainCard`. Only call `issueScopedCard` inside M3 and
its evidence run. If you burn the quota the humans cannot film the demo.

**Frozen files.** `verify.mjs`, `shared/events.mjs`, `src/rain.mjs`, and `src/rainsession.mjs`
are frozen — their hashes are checked by the gate. If you believe one is wrong, STOP, write the
reason in `LOOP.md`, and move to another milestone. Do not edit them, do not soften an assert,
do not add a passing id.

**No new runtime dependencies.** Node built-ins only. The venue network is hostile and a failed
`npm install` at 11pm ends the demo. `@anthropic-ai/sdk` and `viem` are already optional
dependencies; anything else is forbidden.

**Money is integer cents everywhere.** A float in a money field is a defect even if the test
passes.

**Never commit a secret.** `.env.local` is gitignored and stays that way. Never echo the Api-Key,
the session secret, or a private key into a log, a commit, an evidence file, or `LOOP.md`.

## When you are blocked

A milestone that needs something only a human can supply — a funded wallet, a credential, a
network the venue blocks — is BLOCKED, not failed. Write `evidence/<ID>.json` containing
`{"blocked": true, "reason": "<one specific sentence naming what a human must do>"}`, append it
to `LOOP.md`, and move to the next eligible milestone. Do not stub it, do not mock it, do not
mark it done.

## Termination

Stop and exit 0 when `node verify.mjs status` shows M0 through M7 passing or blocked. M8 and M9
are bonus; keep going only if time remains.

Stop and exit 1 after three consecutive iterations with no milestone advancing. Write why in
`LOOP.md` first. A loop that spins is worse than a loop that stops, because the humans will
assume progress they are not getting.

## What matters most, if you have to choose

The demo spine is M3, M5, M6, M7: a real scoped card issued for the group's total, Rain's own
MCC decline, the settle, and the show rendering it. Everything else is decoration. If you can
only get one thing working tonight, make it possible to run `node drive.mjs --live`, open the
renderer, and watch a real Rain card materialize as a spell card and get charged.
