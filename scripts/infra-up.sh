#!/usr/bin/env bash
# Bring up the full infra rig, wait until healthy, then run the seeds the started
# profiles ask for. infra.sh resolves + config-gates the profiles; `up --wait`
# blocks on every service's healthcheck (so no manual health-polling needed here).
#
# The seeds are DISCOVERED, not named: the package owning a compose profile
# declares the script in its `acme.seeds`, and resolve-infra.ts reports the seeds
# of exactly the profiles this command starts. So a slice that needs seeding is
# seeded by adding that line, and a checkout without any such slice runs none.
# (localstripe holds its state in memory, which is why its seed re-runs on every
# infra:up.)
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm with-env ./scripts/infra.sh up -d --wait

# The resolver reads authored values, not the environment, so it needs no env
# hydration — the seeds it names do.
seeds="$(pnpm exec tsx scripts/resolve-infra.ts --seeds)"
while IFS=$'\t' read -r seed_pkg seed_script; do
  if [ -n "$seed_pkg" ]; then
    pnpm with-env pnpm --filter "$seed_pkg" run "$seed_script"
  fi
done <<<"$seeds"
