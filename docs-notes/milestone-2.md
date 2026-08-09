# Milestone 2

- Deployed `orchestrator` now applies embedded idempotent SQL migrations and imports `restaurantmenuchanges.csv` from its root-image Dockerfile on startup.
- Latest production run: 5,000 rows read, 3,753 latest rows, 1,077 deletes skipped, 11 malformed rows skipped, 2,676 items upserted. `/internal/menu` serves Subway and American Deli with integer `price_cents`.
- The migration is embedded in `server/main.go`; keep the Dockerfile root context so the tracked CSV stays available at runtime.
- A temporary Postgres TCP proxy was created solely to run the count query. Removal requires a `confirm` argument not exposed by the available Railway MCP schema; remove `shortline.proxy.rlwy.net:22769` before a public demo.
