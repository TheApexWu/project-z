# Milestone 9

- COMPLETE 2026-08-09. Frontend (web/) + orchestrator API/ws deployed and verified live.

## Architecture (do not re-derive)
- `web/src/`: hash-routed SPA (`#/` live, `#/orders` past, `#/admin` panel). `api.ts` holds `VITE_ORCHESTRATOR_URL` base + sessionStorage basic-auth header helper. Build-time env: Railway frontend service has `VITE_ORCHESTRATOR_URL=https://orchestrator-production-ef93.up.railway.app` (Railpack `npm run build`, root dir `web`). Local builds must set that var to reproduce the prod bundle hash.
- Server (`server/api.go`, `ws.go`, `settings.go`, `proof.go`): `/api/orders` (list, public), `/api/orders/{id}/proof` (public showcase), `/api/settings` + `/api/admins` + `/api/slack/users` (basic auth carson/1234 via `requireAdminAuth`), `/ws?order_id=` hub broadcasting full snapshots on every `orderEngine.changed` (cart/confirm/state). CORS `*` wrapper in main.go.
- `scripts/ws-check.mjs`: creates an order via `/internal/orders` (NO Slack/k8s side effects — agent spawn/DM only happens in the /slack/commands path), subscribes on /ws, adds a cart item, asserts push < 5s, cancels. Run: `node scripts/ws-check.mjs`.

## Hard-won facts
- Org-level Slack token: `users.list` IGNORES JSON bodies — `team_id` must be a query param (GET). Without it Slack returns `missing_argument` and the endpoint 502s. Workspace team id `T0BP3FGUGCU` is inlined in `slackUsersHandler` via `slackClient.get`.
- Railway services here deploy via direct upload (`railway_deploy` MCP), NOT GitHub push — after changing server code, redeploy the orchestrator explicitly.
- ws verification numbers: initial snapshot immediate; cart-add push ~50ms.
- The 3 showcase CLOSED orders (8a2ba264, 7e133227, e7d11a09) appear on the past-orders page with proof views; several CANCELLED probe orders also list (expected).
