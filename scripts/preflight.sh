#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
set -a
source ./API_KEYS
set +a

required=(
  DOORDASH_SIGNING_SECRET DOORDASH_DEVELOPER_ID DOORDASH_KEY_ID
  OPEN_ROUTER_KEY RAIN_TEAM_ID RAIN_USER_ID RAIN_API_KEY
  COLLATERAL_CONTRACT_ID BROWSER_USER_API_KEY
)
for key in "${required[@]}"; do
  [[ -n "${!key:-}" ]] || { printf 'missing required credential: %s\n' "$key" >&2; exit 1; }
done

kubectl --kubeconfig k8s-1-36-0-do-0-ams3-1780491665629-kubeconfig.yaml get nodes

rain_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --header "Api-Key: $RAIN_API_KEY" https://api-dev.raincards.xyz/v1/issuing/cards)
[[ "$rain_status" == 200 ]] || { printf 'Rain status: %s\n' "$rain_status" >&2; exit 1; }

openrouter_response=$(curl --silent --show-error --write-out $'\n%{http_code}' \
  --request POST https://openrouter.ai/api/v1/chat/completions \
  --header "Authorization: Bearer $OPEN_ROUTER_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"model":"z-ai/glm-5.2","messages":[{"role":"user","content":"Reply with ok."}],"max_tokens":1}')
openrouter_status=${openrouter_response##*$'\n'}
[[ "$openrouter_status" == 200 ]] || { printf 'OpenRouter status: %s\n' "$openrouter_status" >&2; exit 1; }

env -u GOROOT go run ./scripts/doordash-smoke.go

browser_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --request POST https://api.browser-use.com/api/v4/runs \
  --header "X-Browser-Use-API-Key: $BROWSER_USER_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"task":"Open https://example.com and report the page title. Do not submit forms, log in, download files, or make changes."}')
[[ "$browser_status" == 200 ]] || { printf 'Browser Use status: %s\n' "$browser_status" >&2; exit 1; }

docker_config_dir=$(mktemp -d)
trap 'rm -rf "$docker_config_dir"' EXIT
install -m 600 ./docker-config "$docker_config_dir/config.json"
docker --config "$docker_config_dir" pull ghcr.io/aaif-goose/goose:sha-86eec2a
docker tag ghcr.io/aaif-goose/goose:sha-86eec2a registry.digitalocean.com/rainxyzhackathon2026/agent:smoke
docker --config "$docker_config_dir" push registry.digitalocean.com/rainxyzhackathon2026/agent:smoke

RAILWAY_CALLER=skill:use-railway@1.3.7 RAILWAY_AGENT_SESSION=railway-skill-m0-20260808 railway status --json >/dev/null
[[ -n "${SLACK_BOT_TOKEN:-}" ]] || { printf 'missing required credential: SLACK_BOT_TOKEN\n' >&2; exit 1; }
[[ -n "${SLACK_SIGNING_SECRET:-}" ]] || { printf 'missing required credential: SLACK_SIGNING_SECRET\n' >&2; exit 1; }
slack auth list
slack app list
printf 'preflight passed\n'
