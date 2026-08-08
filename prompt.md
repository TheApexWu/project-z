# Zarathustra — Ralph loop: how to execute the PRD

You FINISH an existing scaffold on branch `feat/live-settlement`, in the repo you're checked out
in (the `project-z` clone — use the repo root, don't assume a path). **The WHAT lives in
`PRD.json`** — execute its milestones in order, **Lane A (Rain sandbox) before Lane B (Monad
x402)**. Do not restart or greenfield. Read `README.md`, `PRD.json`, and the scaffold first
(`src/rainsandbox.mjs`, `rain.mjs`, `src/x402live.mjs`, `live.mjs`, `test/golden.test.mjs`).

## Overriding rules (beat everything)
- A milestone is **done only when its PRD `verify` command exits 0 AND `node --test` is `fail 0`.**
  You do NOT decide done — the exit code does. Paste the stdout.
- **Any prerequisite missing → STOP:** write `BLOCKED.md`, EXIT 0. Never install toolchains,
  invent a value, fake a tx/txn, or substitute the mock to pass a live milestone.
- **LIVE is opt-in** behind `ZARA_LIVE=1` + `--live`, gated on that flag — NEVER on mere key
  presence. Default path + ALL tests run the mock, keys UNSET, zero network. With `ZARA_LIVE=1`
  and creds absent, fail loudly (non-zero); never silent-fallback.

## FROZEN — any diff is an automatic strike
`src/engine.mjs`, `src/avesta.mjs`, `src/x402mock.mjs`, all `test/*` except `golden.test.mjs`.
`git diff --exit-code` these every iteration; a diff = revert. Never edit a golden constant or
weaken/skip/delete an assertion. The tripwire `test/golden.test.mjs` pins Avesta head
`e5acaa05382d` (a ledger hash, NOT a git commit) — if it changes, revert. Don't run `node run.mjs`
in the loop (it rewrites gitignored `dist/`).

## Money safety
- Constants from env / `.env.local` ONLY; **do NOT invent** an address, URL, key, or field name.
- **Rain (Lane A):** sandbox host only (`api-dev.raincards.xyz`); refuse any other host; never log
  the Api-Key. Real = the settled txn is readable via `GET /issuing/transactions`.
- **Monad (Lane B):** assert `chainId===10143` before signing; never a mainnet token/facilitator;
  ONE settlement per invocation, ≤ `MAX_TEST_USDC`, only in the demo step, never in a retry or
  inside evolve/coevolve/harness; dry-run first; balance-check before/after. Real = an on-chain
  receipt (status success, `from`==wallet). EIP-3009 `transferWithAuthorization` via `viem`
  (optionalDependency, lazy-imported); nonce = fresh `crypto.randomBytes(32)`.
- Faking a hash/id, stubbing the facilitator to `{settled:true}`, or a self-skipping green test are
  PROHIBITED = failure.

## Loop + termination
Each iteration: re-read `PRD.json`; take the next unverified milestone; write its verify FIRST,
then implement; run the **exit gate** = `node --test` (48, fail 0) · frozen-file `git diff` (empty)
· the golden tripwire · the milestone's real proof. A STRIKE = verify non-zero, test `fail>0`, a
frozen-file diff, or a no-op iteration. **3 strikes OR 15 iterations → STOP**, commit
`STOP: <reason, no secrets>`, push.

## Git + secrets
Work ONLY on `feat/live-settlement`; NEVER main; never force-push/amend; never `git add -A`.
**Push after EVERY commit** (loop runs on Carson's machine — the commit log is the remote
monitor). Before each commit, `git diff --cached` — abort if it contains a 64-hex key, an RPC URL,
a `.env*`, `wallet*.json`, or `dist/`. Never write a secret or a signed authorization (a bearer
instrument) to a file or stdout. No deploy (Railway/K8s/hosting); don't touch `docs/*`. Commit as
the human author, NEVER "Co-Authored-By: Claude." Framing: Rain = stablecoin card-issuing
platform; Monad = high-performance parallel-EVM L1 (never "crypto coin").
