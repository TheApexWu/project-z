# Milestone 0

- kubectl is installed and the repo kubeconfig reports three Ready nodes.
- Rain and OpenRouter both returned 200; Browser Use created a trivial cloud run with HTTP 200.
- Registry smoke image push succeeded: `registry.digitalocean.com/rainxyzhackathon2026/agent:smoke` digest `sha256:196e32ba8482b4f0285d08b836d51944938d77acf30009a905834626e604d030`.
- DoorDash JWT now works with a base64url-decoded signing secret and `dd-ver: DD-JWT-V1`; the smoke endpoint returned 404 (authenticated, non-401/403). `scripts/preflight.sh` uses `env -u GOROOT` because the shell exports a stale `/usr/lib/go` GOROOT.
- Slack app `A0BPUB0BJ0Y` is installed with `/begin-order`; see `BLOCKED.md` for the remaining missing static credentials.
- 2026-08-09: Preflight remains blocked only by absent `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`; no milestone was marked complete.
