# Group Grub

Slack-native agentic group food ordering. An admin runs `/begin-order` in Slack
with participants, a total budget, and a restaurant. Each participant gets a DM
from a dedicated AI agent (goose + z-ai/glm-5.2 via OpenRouter) that helps them
build a sub-order within their fair share. When everyone confirms (or the timer
expires, plus a 2-minute grace period), the orchestrator mints a Rain sandbox
card, and submits the order to the DoorDash Drive sandbox. The sandbox card
always declines (dummy card), so the charge is simulated as a Rain authorization
— the full request/response evidence is captured and surfaced on the frontend.
User-facing surfaces frame this expected path as success: the Slack announcement
and live page say **"Order received!"** and link to a receipt page (in
production, a real card would simply be accepted).

## Live system

| Piece                 | Where                                               | Notes                                                                       |
| --------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| Orchestrator (Go)     | https://orchestrator-production-ef93.up.railway.app | `GET /healthz` returns ok                                                   |
| Frontend (Vite/React) | https://frontend-production-8ae0d.up.railway.app    | built from `web/`                                                           |
| Postgres              | Railway service `Postgres`                          | external access via TCP proxy `shortline.proxy.rlwy.net:22769`              |
| Agent pods            | DigitalOcean k8s (3 nodes)                          | one Job per participant per order                                           |
| Slack app             | `Group Grub` (`A0BPUB0BJ0Y`), org `E0BNWAG5A4V`     | workspace `hello rain xyz` (`T0BP3FGUGCU`), channel `#eats` (`C0BNXRJV3AS`) |

Railway project: `skillful-enjoyment` (`17b87956-a6e5-4dee-b0fc-21c383c922c2`),
environment `production`, services `orchestrator`, `frontend`, `Postgres`.

## Running an order

### Prerequisites

- The invoker must be in the `admins` table with `can_create_orders = true`
  (`U0BNXRCAQ3G` is already seeded). Manage others via the admin panel.
- Participants must be members of the workspace. Available test users:
  `U0BNZQ7KR34` (Demo User), `U0BPU5GU6KS` (alexandwu).
- The bot must be a member of the channel: `/invite @Group Grub` in `#eats`
  once.

### Start

In `#eats`:

```
/begin-order @Demo User @alexandwu $40 McDonald's 15m
```

- `@` mentions must be real Slack mentions (the app runs with escaped mentions;
  typed-out `@name` text won't parse).
- Budget is the **total** for the order, split evenly across participants. Hard
  cap: $300 total — anything above is rejected.
- Timer is optional (`15m`, `1h`); default is 15 minutes.
- Restaurant resolves against the menu dataset (McDonald's, Burger King,
  Applebee's, ...). Best-judgment matching is fine.

### What happens

1. Announcement posts to `#eats` with participants, budget, and deadline.
2. Each participant gets a DM; an agent pod spawns within ~15s
   (`kubectl get jobs -l app=group-grub-agent`) and greets them with their
   budget share and menu suggestions.
3. Participants chat in the DM to build a cart. The agent enforces the
   per-person share (over-budget adds are rejected with suggestions to remove
   items). Confirming flips them to ✅ on the announcement. Adding/removing
   items un-confirms; confirmed users can modify until the order closes.
4. When **all confirm** or the **timer expires**, a 2-minute grace period starts
   (modifications still allowed; grace never extends).
5. Then: a Rain card is minted (limit = 1.2× order total, expires 10 minutes
   after issue — long enough to place the order and no longer), the order is
   submitted to the DoorDash Drive sandbox, and the payment leg completes (the
   sandbox card declines by design; in production it would be accepted). The
   announcement ends with **"Order received! ✅"** and a link to the receipt
   page with the full payment/submission evidence.

State machine:
`OPEN → COLLECTING → GRACE → MINTING → SUBMITTING → DECLINED_PROOF_CAPTURED → CLOSED`
(plus `CANCELLED`).

### Cancel an order

```bash
curl -X POST https://orchestrator-production-ef93.up.railway.app/internal/orders/<order-id>/cancel
```

Agent pods exit on their own when the order leaves COLLECTING/GRACE; finished

### End an order early (force close)

While an order is COLLECTING or in GRACE, the channel announcement shows a red
**End order now** button (with a confirm dialog). Clicking it skips the rest of
the timer *and* the grace period — the Rain card mints and the DoorDash sandbox
submission runs within a couple of seconds. Only workspace members in the `admins`
table can use it; anyone else who clicks gets an ephemeral rejection and nothing
changes. Empty orders (nobody added anything) close as `CANCELLED` — no card is
minted for $0.
Jobs are reaped after 10 minutes.

## Admin panel

https://frontend-production-8ae0d.up.railway.app — HTTP basic auth `carson` /
`1234` (PRD hard rule).

- **Admin tab**: Rain client rules for card creation, delivery address, and the
  admins/order-creators list (Slack user picker, backed by `/api/admins` and
  `/api/slack/users`).
- **Past orders**: every order with state, totals, Rain card id, and the full
  receipt JSON (`/api/orders`, `/api/orders/{id}/proof`).
- **Live order**: real-time cart/confirm feed over the `/ws` websocket while an
  order is collecting.

## Day-to-day ops

### Database

No local `psql` on the dev machine; use Docker against the TCP proxy (the
`DATABASE_URL` Railway var uses the internal hostname and is **not** reachable
locally):

```bash
docker run --rm postgres:16-alpine psql \
  "postgresql://postgres:<password>@shortline.proxy.rlwy.net:22769/railway"
```

Password: see `PGPASSWORD` in the Railway `Postgres` service variables.

### Menu data

Live source is the bundled Kaggle CSV (`restaurantmenuchanges.csv`, loaded into
Postgres at startup via `MENU_CSV_PATH`). The Browser Use stealth-scraping spike
failed (90s timeouts against DoorDash); `MENU_SOURCE` defaults to CSV and any
scraper error falls back to CSV. To re-ingest after changing the CSV:

```bash
cd server && go run ./cmd/ingest ../restaurantmenuchanges.csv
```

### Agent image (only when `agent/` changes)

```bash
install -m600 -D ./docker-config /tmp/docker-cfg/config.json
docker --config /tmp/docker-cfg build -f agent/Dockerfile \
  -t registry.digitalocean.com/rainxyzhackathon2026/agent:<git-sha> .
docker --config /tmp/docker-cfg push registry.digitalocean.com/rainxyzhackathon2026/agent:<git-sha>
```

Then set
`AGENT_IMAGE=registry.digitalocean.com/rainxyzhackathon2026/agent:<git-sha>` on
the Railway `orchestrator` service (triggers a redeploy). The tag is pinned —
pods never pull `latest`.

### Deploys

Deploys go through the Railway CLI/MCP; pushing to git alone does not redeploy.

```bash
railway up --service orchestrator   # or: redeploy from the dashboard / MCP
railway up --service frontend
```

- Orchestrator: Dockerfile build, `go build -C server -o orchestrator .`, start
  `./server/orchestrator`, health check `/healthz`.
- Frontend: root directory `web/`, `npm run build`, `npm start` (vite preview).

Variable changes on a service trigger a redeploy automatically. Key orchestrator
vars: `DATABASE_URL`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`,
`OPEN_ROUTER_KEY`, `KUBECONFIG_B64`, `AGENT_IMAGE`, `ORCHESTRATOR_PUBLIC_URL`,
`RAIN_*`, `DOORDASH_*`.

### Kubernetes

```bash
export KUBECONFIG=k8s-1-36-0-do-0-ams3-1780491665629-kubeconfig.yaml
kubectl get nodes
kubectl get jobs -l app=group-grub-agent      # live agent jobs
kubectl logs -l app=group-grub-agent --tail=50
```

Secrets: `group-grub-agent` (bot token + OpenRouter key — re-applied by the
orchestrator on every startup from its env) and `rainxyzhackathon2026` (registry
pull secret). The orchestrator talks to the cluster via `KUBECONFIG_B64`.

## Verifying health

| Check                               | Command                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Env + external APIs                 | `./scripts/preflight.sh`                                                                                  |
| Orchestrator up                     | `curl https://orchestrator-production-ef93.up.railway.app/healthz`                                        |
| Slack token valid                   | `curl -H "Authorization: Bearer $SLACK_BOT_TOKEN" https://slack.com/api/auth.test`                        |
| Workspace grant                     | `curl -H "Authorization: Bearer $SLACK_BOT_TOKEN" "https://slack.com/api/users.list?team_id=T0BP3FGUGCU"` |
| Full e2e (simulated humans, ~7 min) | `./scripts/e2e.sh`                                                                                        |
| Signed slash command (no Slack UI)  | `python3 scripts/slack-cmd.py <url> "<command text>"`                                                     |
| Websocket feed                      | `node scripts/ws-check.mjs`                                                                               |

`e2e.sh` runs a real order through agents, card minting, and the receipt proof;
it is idempotent and safe to re-run (proved twice back-to-back in milestone 10).

## Troubleshooting

| Symptom                                          | Cause                                                                                                     | Fix                                                                                                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slash command does nothing                       | Bot not in channel, or wrong Request URL                                                                  | `/invite @Group Grub`; check app config → Slash Commands → Request URL is the orchestrator `/slack/commands`                                                                  |
| Slash command does nothing, URL correct          | Socket Mode enabled (Slack ignores Request URLs in Socket Mode)                                           | Keep `socket_mode_enabled: false` in the app config; the orchestrator is HTTP-only                                                                                            |
| Slack calls return `invalid_auth`                | Bot token from a previous install (uninstall revokes it)                                                  | Reinstall, copy new `xoxb-` into `API_KEYS` **and** the Railway `orchestrator` service                                                                                        |
| `team_access_not_granted`                        | Org-level app not granted to the workspace, **or** `team_id` missing on `users.list`/`conversations.list` | Org admin: add app to workspace; always pass `team_id=T0BP3FGUGCU` on those two methods                                                                                       |
| Order starts but no agent DMs                    | Spawn failed (kubeconfig, registry, quota)                                                                | Orchestrator logs for `spawn agent ... failed`; `kubectl get jobs -l app=group-grub-agent`; check `KUBECONFIG_B64` / `AGENT_IMAGE`                                            |
| Pod `ImagePullBackOff`                           | `AGENT_IMAGE` tag deleted from DO registry                                                                | Rebuild/push and bump the var                                                                                                                                                 |
| Agent can't reach tools / retries in a loop      | Pod can't reach orchestrator                                                                              | Pods must use the public Railway URL (`ORCHESTRATOR_PUBLIC_URL`); rootless docker can't reach the host                                                                        |
| `/begin-order` says "include at least one @user" | Mentions not parsed                                                                                       | `should_escape` must be on (it is); use real `@` mentions, not typed names                                                                                                    |
| Slack UI demands an interactivity Request URL    | Interactivity toggled on                                                                                  | Leave it off — no buttons/modals exist; enabling it forces a URL for nothing                                                                                                  |
| Only authorized admins...                        | Invoker not in `admins`                                                                                   | Add via admin panel or SQL: `INSERT INTO admins (slack_user_id, can_create_orders) VALUES ('U...', true) ON CONFLICT (slack_user_id) DO UPDATE SET can_create_orders = true;` |

## Slack app maintenance

- Source of truth for the manifest: `slack-app/manifest.json`. Edit the live app
  at https://api.slack.com/apps/A0BPUB0BJ0Y (App Manifest tab) to match.
- The app is **org-deployed** (`org_deploy_enabled: true`). Installing is a
  two-step: install to the org, then an org admin grants it to the workspace.
  Workspace-level install is rejected on this Grid.
- Reinstalling (or adding scopes) mints a **new bot token** and requires
  org-admin re-approval. Update it in: `API_KEYS`, Railway `orchestrator` vars
  (the `group-grub-agent` k8s secret re-syncs from there on startup). The
  **signing secret does not change** on reinstall.
- `apps.manifest.update` via curl does not work with app-level tokens (`xapp-` →
  `not_allowed_token_type`); use the web UI or a config token (`xoxe.xoxp-`).

## Repo map

```
server/     Go orchestrator (Slack commands, order state machine, budget engine,
            Rain minting, DoorDash submission, admin API, websocket hub)
server/cmd/ingest/   CSV menu ingestion tool
server/migrations/   Postgres schema
agent/      Agent image: Dockerfile + bridge.py (DM poller) + mcp_tools.py (MCP tools)
web/        The real frontend (admin panel, past orders, live order page)
frontend/   Dead Vite scaffold — do not use; will be removed
slack-app/  Slack app manifest + CLI scaffold (Bolt app is not what runs in prod)
scripts/    preflight.sh, e2e.sh/.mjs, slack-cmd.py, ws-check.mjs, doordash-smoke.go
docs-notes/ Per-milestone notes left by the ralph loop (good archaeology)
PRD.JSON    Product requirements + milestone completion record
RALPH.md    Build-loop status/history; ralph.sh is the loop runner
API_KEYS    Local credentials (gitignored)
```

## Known caveats

- `API_KEYS` has legacy misspelled keys (`SLACK_SIGNING_SECERT`,
  `SLACK_CLIENT_SECERT`) alongside the canonical `SLACK_SIGNING_SECRET`; the
  server reads the correct one.
- `DOORDASH_TEMP_JWT` is stale; Drive auth signs JWTs from the key pair at
  runtime.
- `carson_member_id` is a scratch file with the order-creator Slack ID.
- The bridge treats any DM message it didn't post as participant input — if
  another bot/integration posts into a participant DM, the agent will answer it.
- The DoorDash "payment" declining in the sandbox is the intended outcome, not a
  bug — user-facing surfaces present the completed path as "Order received!".
