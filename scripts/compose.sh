#!/usr/bin/env bash
# Run `<engine> compose <args>` using whichever container engine is available.
# Override with CONTAINER_ENGINE=docker|podman.
set -euo pipefail

engine="${CONTAINER_ENGINE:-}"

if [ -z "$engine" ]; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    engine=docker
  elif command -v podman >/dev/null 2>&1; then
    engine=podman
  else
    echo "compose.sh: no usable container engine found (need docker or podman)." >&2
    exit 1
  fi
fi

exec "$engine" compose "$@"
