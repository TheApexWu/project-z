# Milestone 1

- Railway project `17b87956-a6e5-4dee-b0fc-21c383c922c2` now has Postgres, `orchestrator`, and `frontend`, all SUCCESS.
- Orchestrator: `https://orchestrator-production-ef93.up.railway.app`; `/healthz` returns `ok; database ping: succeeded` via `${{Postgres.DATABASE_URL}}`.
- Frontend: `https://frontend-production-8ae0d.up.railway.app`; `VITE_ORCHESTRATOR_URL` points at the orchestrator. Vite preview requires `allowedHosts: true` for Railway's service domain.
- All `API_KEYS` entries are configured on `orchestrator`; do not expose their values in future notes or commands.
