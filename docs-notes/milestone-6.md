# Milestone 6

- COMPLETE 2026-08-09. Live run: signed `/begin-order` (U0BNZQ7KR34 + U0BPU5GU6KS, $40, McDonald's, 15m) spawned two agent Jobs in ~12s; scripted DMs (bot-token posts into the participant DM) drove greet → menu-under-$10 → add fries → proposal → yes → confirmed; announcement flipped to ✅; pods self-exited Completed on cancel. Test order 8c36d7c6-6b37-41c1-b444-4504c1d984d0 cancelled afterwards.

## Architecture (do not re-derive)
- `agent/Dockerfile`: goose base + python3 + `agent/bridge.py` (DM poller) + `agent/mcp_tools.py` (zero-dependency MCP stdio JSON-RPC server; config from `/tmp/agent-env.json` written by the bridge, NOT env propagation).
- Orchestrator spawns one k8s Job per participant in `attachSlack` via `kubectl apply` (kubectl baked into the root Dockerfile; kubeconfig from `KUBECONFIG_B64` env written to `/tmp/group-grub-kubeconfig`). Spawn is async (goroutine) to stay inside Slack's 3s ack.
- Job: name `agent-<orderID-nodashes>-<lowercase-uid>`, labels `app=group-grub-agent` + `order=<orderID>`, ns `default`, `ttlSecondsAfterFinished: 600`, `backoffLimit: 1`, requests 250m/512Mi, limits 1/1Gi, `imagePullSecrets: rainxyzhackathon2026` (pre-existing DO registry secret). Agents self-exit when order state leaves COLLECTING/GRACE.
- Secret `group-grub-agent` (default ns) holds SLACK_BOT_TOKEN + OPENROUTER_API_KEY; orchestrator re-applies it every startup.
- `AGENT_IMAGE` Railway var pins the image (currently `registry.digitalocean.com/rainxyzhackathon2026/agent:9165903`). Bump it after changing `agent/` and rebuild+push (`docker --config` needs a dir; `install -m600 -D ./docker-config <dir>/config.json`).

## Hard-won facts for later milestones
- Scripted humans (milestone 10 e2e): the bridge treats ANY DM message whose ts it didn't post as participant input, so `chat.postMessage` with the BOT token into the participant's DM channel simulates a human. No user token exists (slack CLI only has the xoxe config token).
- goose: use `--output-format stream-json` and take the LAST assistant message's concatenated `text` parts (`bridge.extract_reply`). Raw `-q` stdout leaks tool-call box rendering — do not post it to Slack. Flags: `--no-profile --max-turns 15 --max-tool-repetitions 3 --with-extension 'python3 /opt/agent/mcp_tools.py'`, session `-n dm` + `--resume`. Provider via env GOOSE_PROVIDER=openrouter GOOSE_MODEL=z-ai/glm-5.2 OPENROUTER_API_KEY.
- glm-5.2 tool-calling via goose MCP works; turns run 3-20s. On tool errors the model retries identical calls — the earlier "loop" was connection-refused retries, not a protocol bug.
- Rootless docker on this machine: containers CANNOT reach the host (--network host, host-gateway, 172.17.0.1 all fail) but CAN reach the public internet. Test agents against the deployed Railway URL, not a local server.
- New orchestrator endpoints: `GET /internal/orders/{id}/participants/{uid}/cart` (items+total), `GET .../budget` (share/total/remaining), `POST .../cart/remove {name}` (exact case-insensitive name; unconfirms like add does). Menu items JSON now includes `id` (CSV source only).
- Railway MCP quirk: tools reject `service_id: null`; always pass the explicit service UUID (orchestrator 4cecca50-fd8d-4c1c-bc4a-a34cfe9c1a58).
