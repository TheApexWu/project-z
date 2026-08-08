# Zarathustra — the Ralph loop

You are ONE iteration. You have no memory of the previous one and you will not remember this one.
Everything the next iteration needs must be **committed to a tracked file before you exit**.

You are FINISHING an existing scaffold on branch `feat/live-settlement`, in the repo you are checked
out in (use the repo root; do not assume a path). Do not restart, greenfield, or rewrite.

## Read in this order, every iteration, before you touch anything
1. `PRD.json` — the WHAT and the whole map. `PRD.surface` lists **every module, every entrypoint,
   every page, every output that already exists**. Read it before creating any file: if something is
   already in the map, extend it, do not duplicate it. `PRD.concepts` is the vocabulary — use those
   words, do not invent synonyms.
2. `LOOP.md` — the only memory. What has been tried, what passed, what is blocked, the counters.
3. `README.md`, then the header comment of every file you are about to touch.

## The iteration algorithm — run exactly this, in this order

**1. Self-check.** `shasum -a 256 verify.mjs` must equal
`2edb447d35ec554b5e5619060eb0bc65199b893456920f3470a15356be905c20`.
Mismatch → the gate has been tampered with: `git checkout -- verify.mjs`, log a STRIKE, exit.

**2. Read state.** From `LOOP.md`: `iterations` = number of `## iter` blocks;
`strikes` = number of `result: STRIKE` lines **since the most recent `result: PASS`**.
If `iterations >= 25` or `strikes >= 3` → go to **Terminate**.

**3. Exit gate, before any work.** `node verify.mjs gate`.
Non-zero here means the repo is already broken — **fix that and nothing else this iteration**
(a frozen file drifted → `git checkout -- <path>`). Never build on a red gate.

**4. P0.** Re-run the environment preflight and rewrite `evidence/P0.json`. Credentials appear and
expire during an event; lane eligibility is a fact you re-measure, never one you remember.
Presence is not proof — if a lane reports ready, prove it (Rain: a 2xx from
`GET /issuing/transactions`; Monad: `eth_chainId` == 10143 and a non-zero balance).

**5. Pick exactly ONE milestone.** The first in `PRD.milestones` whose `status` is not
`verified:*`, whose `deps` are all verified, and whose lane P0 reports `ready`.
Lane A (Rain) outranks Lane B (Monad) at equal readiness — Rain is the primary prize.
- Nothing eligible but something is blocked → pick the next **unblocked** milestone in the other
  lane. Block the milestone, never the loop.
- Every milestone verified or blocked → go to **Improve**.

**6. Write the verify FIRST.** Before implementing, write the evidence file's shape and run
`node verify.mjs <ID>` — it must **FAIL**. A verify that passes before you build anything is
measuring nothing, and you have just learned that in advance instead of after.

**7. Implement.** One milestone. At most 3 new files. Confirm every external field name against the
docs before you script it — do not guess a key name and do not invent a value.

**8. Prove.** Run it for real, write `evidence/<ID>.json` from the actual response, then:
`node verify.mjs <ID>` **and** `node verify.mjs gate`. Both exit 0 or the milestone is not done.
**You do not decide done — the exit code does.** Paste both stdouts into `LOOP.md`.

**9. Record.** Update the milestone's `status` in `PRD.json` (`verified:<ISO>` / `blocked:<what>`),
append the `LOOP.md` block, `git add` the specific paths, commit, **push**.
One commit per iteration. Push after every commit — the commit log is the remote monitor.

## LOOP.md — append-only, exact format

```
## iter <N> · <ISO timestamp> · <MILESTONE ID>
gate: tests <n>/fail 0 · frozen OK · verify.mjs sha OK
lanes: rain=<ready|blocked:VARS> monad=<ready|blocked:VARS>
did: <one line — what was actually built or attempted>
verify: node verify.mjs <ID> -> <exit code>
result: PASS | STRIKE | BLOCKED | DONE
next: <the milestone the next iteration should pick, and why>
for the human: <anything only a person can unblock — keys, a faucet, a docs/* change. omit if none>
```

Never rewrite an earlier block. A wrong entry gets a new block that corrects it.

## Definitions — not judgement calls

**PASS** — the milestone verify and the gate both exited 0.

**STRIKE** — any of: the verify exited non-zero · the gate exited non-zero · a frozen file changed ·
the `verify.mjs` sha mismatched · the iteration produced no commit. Three consecutive strikes
(reset by any PASS) → Terminate.

**BLOCKED** — a prerequisite only a human can supply is missing (a credential, a funded wallet, an
approved dependency). Then: `status: blocked:<what is missing>`, write
`evidence/BLOCKED-<ID>.json`, name it under `for the human:`, and **move to the next eligible
milestone in either lane**. A blocked milestone is not a strike and does not stop the loop.
`BLOCKED.md` is gitignored — it is a note for the person at the desk and is invisible to the remote
monitor, so it never counts as recording anything.

## Improve mode — only when every milestone is verified or blocked

Work `PRD.improve.backlog` in order, one item per iteration, under the same discipline: verify
first, real proof, exit gate, one commit, push. Improve work may **never** touch a frozen file, add
a runtime dependency, edit `docs/*`, or deploy. Backlog empty → `result: DONE` and Terminate.

If you believe something belongs in the backlog that is not there, append it to
`PRD.improve.backlog` with a machine-checkable verify **and** note it under `for the human:` —
but do it as its own iteration, and never in place of the item you were supposed to do.

## Frozen — a diff here is a revert, not a discussion

`src/engine.mjs`, `src/avesta.mjs`, `src/x402mock.mjs`, every `test/*.mjs` except
`test/golden.test.mjs`, and `verify.mjs`. Enforced by sha256 inside `verify.mjs`.
`test/golden.test.mjs` may only gain live-mode assertions: it must keep the literal `e5acaa05382d`
(a ledger hash, **not** a git commit) and never drop below 4 asserts.
Never weaken, skip, `.only`, or delete an assertion. Never edit a golden constant.
Do not run `node run.mjs` in the loop — the tripwire already pins its output.

## Money safety

- Constants come from env / `.env.local` **only**. Do not invent an address, URL, key or field name.
- **Rain (Lane A):** sandbox host `api-dev.raincards.xyz` only — refuse any other host. Never log
  the Api-Key. Real means: the settled txn is readable back via `GET /issuing/transactions`.
- **Monad (Lane B):** assert `chainId === 10143` before signing. Never a mainnet token or
  facilitator. **ONE settlement per invocation**, `<= MAX_TEST_USDC`, only in the demo step — never
  in a retry, and never inside `evolve`, `coevolve` or `harness`. Dry-run first; balance-check
  before and after. Real means: an on-chain receipt with `status success` and `from == wallet`.
  EIP-3009 `transferWithAuthorization` via `viem` (optionalDependency, lazy-imported);
  nonce = fresh `crypto.randomBytes(32)`.
- **Live is opt-in** behind `ZARA_LIVE=1` plus an explicit flag — **never on mere key presence**.
  The default path and all tests run the mock, keys unset, zero network. With the flag set and creds
  absent, fail loudly and non-zero. Never silently fall back to the mock.
- Faking a hash or id, stubbing the facilitator to `{settled:true}`, or a self-skipping green test
  is a failure, not a shortcut. **Both live outcomes are publishable** — if Rain declines the flip,
  record that and report the capture-drift residual instead. Only the fabricated result loses.

## Git and secrets

Work only on `feat/live-settlement`. Never `main`, never force-push, never amend, never `git add -A`
— stage explicit paths. Before every commit run `git diff --cached` and abort if it contains a
64-hex key, an RPC URL with credentials, a `.env*`, `wallet*.json`, or `dist/`. Never write a
secret or a signed authorization to a file or to stdout. Commit under the human author's name.
No deploys — no Railway, no hosting, no CI changes. Do not edit `docs/*`.

## Terminate

Write a final `LOOP.md` block with `result: DONE` (backlog empty) or `result: STRIKE` plus the
reason and everything under `for the human:`. Commit `STOP: <reason, no secrets>`, push, exit 0.
Never install a toolchain, invent a value, or widen scope to avoid stopping.

## Framing

Rain is a stablecoin card-issuing platform. Monad is a high-performance parallel-EVM L1.
Never write "crypto coin". Zarathustra is a **gauge, not a firewall** — it prices the residual that
in-policy attacks leave behind; it does not block anything.
