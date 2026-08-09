# Milestone 5

- COMPLETE 2026-08-09. Live verification passed: signed `/begin-order` (2 users, $40, McDonald's, 15m) posted the announcement in `#eats` (C0BNXRJV3AS, ts 1786261988.975629); curl confirm flipped the checklist to ✅ in 0.20s; both DMs received the intro message; forged signature got 401. Test order a499d5c6 cancelled afterwards (announcement showed CANCELLED, proving state-change updates).
- Fixes applied this iteration:
  - `Dockerfile`: runtime image lacked CA certs — every Slack call failed `x509: certificate signed by unknown authority`. Added `ca-certificates` to the debian-slim stage; redeployed.
  - Manifest: `messages_tab_enabled: true` (was false → `conversations.open` failed `messages_tab_disabled`). Applied via `apps.manifest.update` with the CLI config token (see below).
  - Manifest: added `channels:history` bot scope (needed to read the announcement for verification; milestone 10 e2e needs it too). Reinstalled with `slack app install -E local --team E0BNWAG5A4V --org-workspace-grant T0BP3FGUGCU` from `slack-app/`. Bot token was NOT rotated; no API_KEYS/Railway update needed.
  - WARNING: plain `slack app install` (no `-E local`) created a stray duplicate app A0BNK688ZLP; deleted via `slack app delete --app A0BNK688ZLP`. Always use `-E local`.
- Config token for `apps.manifest.*`: `~/.slack/credentials.json` → `E0BNWAG5A4V.token` (xoxe.xoxp-...). Works for export/update; the app-level xapp token does NOT.
- `scripts/slack-cmd.py <url> <text> [forged]` sends a validly-signed (or forged) `/begin-order` as admin U0BNXRCAQ3G in #eats; used for verification and reusable in e2e.
- Milestone 6 note: DM bridge should poll `conversations.history` on each participant's `dm_channel_id` (`im:history` already granted; Socket Mode is off). Bot is a member of #eats only; announcement channel for tests = C0BNXRJV3AS.
- Implemented and deployed signed Slack command intake, OpenRouter-assisted parsing, persisted Block Kit announcement updates, and participant DM setup. `env -u GOROOT go test ./...` passed in `server`.
- Previous BLOCKED diagnosis was partly wrong. Corrections, verified against Slack docs and this codebase:
  - `users.list` / `conversations.list` are NEVER called by the orchestrator. It only calls `chat.postMessage`, `conversations.open`, `chat.update` (`server/slack.go`). Do not treat those two methods as a blocker.
  - Org-wide tokens require a `team_id` param on `users.list`/`conversations.list`; omitting it returns `team_access_not_granted` even when the grant is healthy. Workspace is `T0BP3FGUGCU`, enterprise `E0BNWAG5A4V`.
  - `apps.manifest.update` rejects app-level tokens (`xapp-`) with `not_allowed_token_type`. It needs a config token (`xoxe.xoxp-...`) from api.slack.com/authentication/config-tokens. Manifest was applied via the web UI instead; do not retry the API path.
  - Workspace-level install is rejected on this Grid with `scope_not_allowed_on_enterprise`. The app must stay org-ready (`org_deploy_enabled: true`) and be granted to the workspace by an org admin.
- `slack-app/manifest.json` fixes applied (mirrored into the live app config):
  - `socket_mode_enabled: false` — with Socket Mode on, Slack ignores the slash-command Request URL, so `/begin-order` never reached Railway. The Go server is HTTP-only.
  - `should_escape: true` — required for slash commands in Enterprise orgs. Unescaped text sends `@name`, which `mentionPattern` (`server/slack.go:36`, uppercase-only) cannot parse, leaving `order.Users` empty.
  - `interactivity.is_enabled: false` — no buttons/`action_id`/`block_actions` exist anywhere, and there is no interactivity route. Enabling it forces a Request URL requirement for nothing. Add a `/slack/interactivity` route first if buttons are ever introduced.
  - Added `im:history` bot scope for the milestone 6 DM bridge (reading DM replies). Scope changes need a fresh org install plus admin re-approval, so it was folded in now.
- Milestone 6 consequence: Socket Mode is off, so the PRD's "socket-modes the DM channel" option is unavailable. Use `conversations.history` polling (needs only `im:history`, no public URL) or add a `/slack/events` route with a Request URL.
- Order creator member ID for verification: `U0BNXRCAQ3G` (also in `./carson_member_id`).

## Preconditions — ALL RESOLVED 2026-08-09T07:44Z, do not redo
1. Slack credentials are live. `auth.test` returns ok with `bot_id=B0BP00EBE4A`, bot user `U0BP1U9PS1X`, `enterprise_id=E0BNWAG5A4V`, `is_enterprise_install=true`. A new bot token was minted by the reinstall and written to BOTH `API_KEYS` and the Railway `orchestrator` service (redeployed 07:44:01Z, SUCCESS, `/healthz` 200). `SLACK_SIGNING_SECRET` was unchanged by the reinstall.
2. Workspace grant is in place: `users.list?team_id=T0BP3FGUGCU` returns ok with 5 members.
3. `admins` row seeded and verified: `U0BNXRCAQ3G` with `can_create_orders = t`.

Re-check command if Slack calls start failing:
`curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" "https://slack.com/api/users.list?team_id=T0BP3FGUGCU" | jq '.ok, .error'`

## Test identities in T0BP3FGUGCU
- `U0BNXRCAQ3G` — order creator / admin (the only row in `admins`).
- `U0BNZQ7KR34` (Demo User) and `U0BPU5GU6KS` (alexandwu) — use as the two participants for the "both participants received DMs" verification.

Local tooling note: `psql` is not installed on this machine. Reach Postgres with
`docker run --rm postgres:16-alpine psql "<DATABASE_PUBLIC_URL>"` using the TCP proxy
`shortline.proxy.rlwy.net:22769` (the `DATABASE_URL` var is the internal hostname and is not reachable from here).

Note: `API_KEYS` still carries legacy misspelled keys (`SLACK_SIGNING_SECERT`, `SLACK_CLIENT_SECERT`) alongside the canonical `SLACK_SIGNING_SECRET`. The server reads only the correctly spelled one.
