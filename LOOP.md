# LOOP — the Ralph loop's only memory

Append-only. One block per iteration, in the exact format in `prompt.md`. Never rewrite an earlier
block; a wrong entry gets a new block that corrects it. Counters are derived from this file:
`iterations` = number of `## iter` blocks · `strikes` = `result: STRIKE` lines since the most
recent `result: PASS`.

## iter 0 · seed · —
gate: tests 48/fail 0 · frozen OK · verify.mjs sha OK
lanes: rain=unknown monad=unknown
did: seeded the loop harness — verify.mjs (the single machine gate, sha-pinned in prompt.md), the
     PRD milestone/evidence contract, and this journal. No product code written.
verify: node verify.mjs gate -> 0 · node verify.mjs status -> all FAIL (no evidence yet, correct)
result: PASS
next: P0 — re-run the environment preflight and write evidence/P0.json. It decides which lanes are
     eligible; nothing else can start until it has.
for the human: Rain keys (Api-Key, userId, teamId, contractId, sessionid) from the workshop desk,
     and a funded Monad testnet wallet + `npm i viem`, both into `.env.local`.
