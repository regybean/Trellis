#!/usr/bin/env bash
# Shared library for dev/compose log capture (ADR 0028). Sourced, not executed.
#
# The genuine shared primitive is the file-lifecycle contract (identical header
# shape across dev + infra files): `prepare_log` owns truncate + freshness
# header; `mirror_stream` adds the infra follower on top. `resolve_engine`
# (extracted from compose.sh) keeps engine detection identical across both.

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

# prepare_log <label> <file> — start a fresh single-generation log: truncate
# <file>, then write the dated freshness header `# <label> started <ISO8601Z>` as
# line 1. The timestamp is single-sourced from $START (set once per pnpm dev
# session by dev.sh), so every file from one launch shares the same instant and
# the newest header across logs/*.log marks that launch (ADR 0028 §1, §6).
prepare_log() {
  local label="$1" file="$2"
  : >"$file"
  printf '# %s started %s\n' "$label" "$START" >>"$file"
}

# mirror_stream <label> <file> <cmd…> — prepare_log, then run <cmd…> as a
# backgrounded follower appending its stdout+stderr to <file>. Echoes the
# follower PID so the caller can collect it for the reap trap. Infra-only: the
# dev-server branch appends below turbo instead (ADR 0028 §2, §5).
mirror_stream() {
  local label="$1" file="$2"
  shift 2
  prepare_log "$label" "$file"
  "$@" >>"$file" 2>&1 &
  printf '%s\n' "$!"
}
