#!/usr/bin/env bash
# Bring up infra (via infra.sh, which applies provider-aware profile gating),
# then seed localstripe once it's healthy. localstripe state is in-memory, so
# the seed runs on every infra:up.
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm with-env ./scripts/infra.sh up -d

# Seed only when configured for localstripe (real Stripe needs no seeding).
if grep -qE '^\s*STRIPE_API_BASE=' .env 2>/dev/null; then
  echo "Waiting for localstripe to be healthy…"

  # Probe the container engine directly rather than `compose ps`: podman-compose
  # rejects `ps -a`/`{{.Health}}`, and the compose project prefix is fixed
  # ("trellis-*"), independent of DB_NAME. `inspect` works the same on docker and
  # podman. `|| true` keeps `set -e` from aborting before the container exists.
  engine="${CONTAINER_ENGINE:-}"
  if [ -z "$engine" ]; then
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      engine=docker
    elif command -v podman >/dev/null 2>&1; then
      engine=podman
    else
      echo "infra-up.sh: no usable container engine found (need docker or podman)." >&2
      exit 1
    fi
  fi

  container="trellis-localstripe"
  for _ in $(seq 1 40); do
    health="$("$engine" inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || true)"
    if [ "$health" = "healthy" ]; then
      break
    fi
    sleep 1
  done

  pnpm with-env pnpm --filter @acme/billing seed:localstripe
fi
