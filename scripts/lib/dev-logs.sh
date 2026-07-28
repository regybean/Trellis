#!/usr/bin/env bash
# Shared library for dev/compose log capture (ADR 0028). Sourced, not executed.
#
# The genuine shared primitive is the file-lifecycle contract; this first cut
# holds only `resolve_engine`, extracted from compose.sh so both it and the
# later dev.sh wiring resolve the container engine identically (no drift).

# resolve_engine — echo the container engine to use.
# Honours CONTAINER_ENGINE override; else docker if usable, else podman, else
# fails (return 1). Identical logic to the block previously inlined in compose.sh.
resolve_engine() {
  local engine="${CONTAINER_ENGINE:-}"

  if [ -z "$engine" ]; then
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      engine=docker
    elif command -v podman >/dev/null 2>&1; then
      engine=podman
    else
      echo "resolve_engine: no usable container engine found (need docker or podman)." >&2
      return 1
    fi
  fi

  printf '%s\n' "$engine"
}
