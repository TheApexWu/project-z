# z-draft — Project Zarathustra (prototype)

**The gauge, not a firewall.** Measure, in dollars, what an agent's spend controls let slip through on x402/Monad — when the agent is prompt-injected but stays inside the caps.

Rain's Agent Control Layer and wallet policy engines (Turnkey, Privy, Circle, Coinbase, Fireblocks) already ship the firewall. This does not compete with them — it **measures what they miss**. Vendors are the audience, not the competition. A successful attack here is a data point, not a failure.

## Run

```
node run.mjs      # the full loop -> console + dist/report.html
node --test       # 47 tests, zero deps
```

Zero runtime dependencies. Deterministic (seeded). Two runs produce the same Avesta head hash (`e5acaa05382d`). The whole crash-test is one pipeline — `engine.runOnce(policy, seed)` (`src/engine.mjs`) — shared by the CLI, the tests, and the future live web server, so live == recorded == static.

## Demo mockups (the visual work)

Three standalone, zero-dependency HTML mockups live in [`docs/`](docs/). GitHub shows their source, not the rendered page — **clone the repo and open [`docs/index.html`](docs/index.html) in a browser** (or open any file directly):

- [`docs/touhou.html`](docs/touhou.html) — the **Imperishable Night** direction: a bullet-hell danmaku playfield (injected agent → cap-gate laser → one flip threads to the vault) with a right-hand arcade HUD wired to the real metrics.
- [`docs/sample.html`](docs/sample.html) — the **terminal cockpit** working demo: the attack swarm, an honest cap slider (drag below $50 and the flip is sealed), the coevolution convergence, the re-rank, and the signed receipt.
- [`docs/catalog.html`](docs/catalog.html) — the **design-system catalog**: palette, typography, motif, components, the game/media reference board.

Every number in the mockups is the real computed value: headline `$49.97`, coevolution floor `$19.99`, re-rank `#5 → #1`, Avesta head `e5acaa05382d`.

A generated snapshot of the dashboard is committed at [`docs/report.html`](docs/report.html) so you can see it without running — it's produced by `node run.mjs` (the live `dist/report.html` is gitignored so it never drifts into a stale screenshot). Regenerate the snapshot with `node run.mjs && cp dist/report.html docs/report.html`.

## What it does

- **Asha** (`src/asha.mjs`) — the reference gate. A commodity static policy (cap / allowlist / velocity / price-band). The **baseline we measure**, not the contribution.
- **agent + injection** (`src/agent.mjs`, `src/injection.mjs`) — a pluggable buyer agent. Default is a deterministic rule stub (no key). A Claude path (`ANTHROPIC_API_KEY`) reads the injected merchant text and decides for real, degrading to the stub when absent.
- **x402 mock** (`src/x402mock.mjs`) — a facilitator modeling the grant-before-settle gap (verify offchain, settle async, revert in the speculative window) + an optional nonce ledger.
- **oracle** (`src/oracle.mjs`) — grades outcomes by **verified funds-moved severity** (L0/L4/L5, and L6 for structuring chains), not by whether text looked jailbroken.
- **Druj** (`src/druj.mjs`) — the evolutionary fuzzer. Evolves the injected-but-in-policy purchase a static gate waves through (fitness = `$ moved × severity`), plus a MAP-Elites archive over tactics. Optional `collectScene` exports the per-generation population — the animation script for the demo scene.
- **coevolve** (`src/coevolve.mjs`) — the arms-race floor. Tighten the cap toward the legit ceiling each round; the attacker's take falls `$49.97 → $19.99` while sealed-$ rises to `$30.01`, converging to a **non-zero floor** (the residual recipient-flip a quantitative gate structurally can't reach). Computed, not asserted.
- **corpus + profiles + harness** (`src/corpus.mjs`, `src/profiles.mjs`, `src/harness.mjs`) — the benchmark. Runs a fused protocol+policy corpus against tight/loose/no-gate policies over N trials and **measures** success-rate + dollars-moved.
- **Rashnu** (`src/rashnu.mjs`) — scores `$-at-risk = success × dollars × reversibility` and **re-ranks** vs binary success-rate.
- **Avesta** (`src/avesta.mjs`) — a tamper-evident hash-chained evidence log of verdicts.
- **report** (`src/report.mjs`) — a self-contained HTML dashboard (`dist/report.html`).

## The result it demonstrates

A static gate blocks the obvious attack ($900 to an unknown address) but cannot tell a legitimate $49 buy from a prompt-injected $49 buy to a different allowlisted payee. Druj finds that bypass; the harness measures the whole corpus across policies; Rashnu shows the punchline: **the injected recipient-flip is ranked last by binary success-rate (it's rare — tight caps catch it) but #1 by dollars-at-risk (when it lands it moves ~25× more than the cheap-but-common attacks).** Today's benchmarks would deprioritize the attack that moves the most money. (Ranks are recomputed every run; the leaderboard pools the tight/loose/no-gate profiles with equal weight — the re-rank *direction* is invariant to the mix, the exact ranks are conditional on it.)

## Honest scope (read before pitching)

- **Mock rails.** `x402mock` + `reorgRate` are a *model* of the Monad speculative-settlement gap, not a measurement. No testnet, no creds, no chainId 10143 touched. The only real Monad settlement-gap number comes later (Carson's lane).
- **Avesta is local.** A hash-chained JSONL, not on-chain. Tamper-evidence is real (recomputable sha256), but there is no external anchor — pitch it as "verifiable append-only evidence, swappable to on-chain via the sink seam." Never "on-chain now."
- **Reversibility is assumed.** A per-vector weight, labeled `(assumed)`. It is the exact slot Carson's real Monad finality number plugs into. asr and dollars are *measured* from runs.
- **Severity ladder.** Only L0/L4/L5 on the 3-arg oracle path; L6 needs the structuring chain path; L1–L3 are labeled-but-unimplemented.
- **The bypass is an allowlisted decoy, not a broken allowlist.** $49.97 to 0xInference (allowlisted, wrong merchant). 0xAttacker can never pass Asha.
- **Druj demonstrates the loop.** It matches-or-exceeds equal-budget random search here (near-saturated genome); it does **not** "beat" or "dominate" random — a test enforces the small margin. The richer genome (multi-step L6, band-gaming) is the build-out.
- **Attacks are reproduced published work** (the credibility floor). The contribution is the gauge + the oracle + the $-re-ranking, not the attacks.

## Not yet wired (Carson's lane)

Real `@x402` client/facilitator on **Monad testnet** (chainId `10143`); a measured **Monad settlement-gap** number (speculative ~400ms vs deterministic ~800ms) that plugs into `reorgRate` / reversibility; Avesta anchored on-chain via the `sink` seam.

## Status

Draft. Mock rails, seeded, single-step demo. `node --test` is green; every dollar printed traces to a value computed that run; `dist/` is generated, never committed.
