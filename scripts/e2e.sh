#!/usr/bin/env bash
# Milestone 10: full end-to-end test with simulated humans against the deployed
# (Railway + k8s) stack. Runs ~7 minutes (3m order timer + 2m grace + mint/submit).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
set -a
source ./API_KEYS
set +a

export ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-https://orchestrator-production-ef93.up.railway.app}"
export FRONTEND_URL="${FRONTEND_URL:-https://frontend-production-8ae0d.up.railway.app}"
export RAIN_API_BASE="${RAIN_API_BASE:-https://api-dev.raincards.xyz/v1}"

exec node scripts/e2e.mjs
