#!/usr/bin/env bash
# Shared preamble for env-pull.sh / env-push.sh — the wiring both directions
# need before either can do anything, in one place instead of nineteen
# near-identical lines twice.
#
# It resolves the repo, sources the config, dispatches to the selected backend
# adapter, and defines `secrets_sync` — the one way into @acme/secrets-sync,
# which holds every decision these scripts used to make in an inline `node -e`
# string.
#
# What stays shell, deliberately: the backend dispatch by filename convention
# and the adapters themselves. `scripts/secrets-backends/<name>.sh` is a
# published extension point (see _template.sh) — a consumer adding a backend
# writes shell, so the seam it plugs into is shell.
#
# Sourced, never run. Callers own `set -euo pipefail`.

# This file lives in scripts/lib/, so the two directories above it are fixed.
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPTS_DIR/.." && pwd)"
SECRETS_CLI="$REPO_ROOT/tooling/secrets-sync/src/cli.ts"

# SECRET_MAP's paths are repo-relative.
cd "$REPO_ROOT" || exit 1

# The wiring: SECRETS_BACKEND + SECRET_MAP. `SECRETS_CONFIG` overrides the file
# for a caller driving a different set of env files than the repo's own — the
# round-trip test is the one in-repo caller.
SECRETS_CONFIG="${SECRETS_CONFIG:-$REPO_ROOT/secrets.config.sh}"
if [ ! -f "$SECRETS_CONFIG" ]; then
  echo "No secrets config at $SECRETS_CONFIG" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$SECRETS_CONFIG"

if [ -z "${SECRETS_BACKEND:-}" ]; then
  echo "SECRETS_BACKEND is not set — secrets sync needs an explicit backend." >&2
  echo "  SECRETS_BACKEND=localstack  dev/demo, against the infra LocalStack vault" >&2
  echo "  SECRETS_BACKEND=aws         a real cloud vault (AWS Secrets Manager)" >&2
  echo "Without it, fill .env by hand from .env.example." >&2
  exit 1
fi

adapter="$SCRIPTS_DIR/secrets-backends/${SECRETS_BACKEND}.sh"
if [ ! -f "$adapter" ]; then
  echo "Unknown SECRETS_BACKEND '$SECRETS_BACKEND' (no $adapter)" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$adapter"

# @acme/secrets-sync's CLI: composition, classification, the diff and the merge.
# Run from source with tsx (no build step, matching the other tooling packages).
#
# The installed binary directly, rather than `pnpm exec tsx`: pnpm resolves the
# workspace on every call before it launches anything, which more than doubles
# the cost of a launch, and a sync of five files makes ten of them. `pnpm exec`
# stays as the fallback for a tree whose bins are somewhere else.
if [ -x "$REPO_ROOT/node_modules/.bin/tsx" ]; then
  SECRETS_TSX=("$REPO_ROOT/node_modules/.bin/tsx")
else
  SECRETS_TSX=(pnpm exec tsx)
fi

secrets_sync() {
  "${SECRETS_TSX[@]}" "$SECRETS_CLI" "$@"
}

# A private directory for the plan blocks and the JSON documents the CLI reads.
# Vault payloads pass through files rather than argv, where `ps` could read them.
secrets_workdir() {
  local dir
  dir="$(mktemp -d "${TMPDIR:-/tmp}/secrets-sync.XXXXXX")"
  chmod 700 "$dir"
  printf '%s' "$dir"
}

# Ask a yes-default question. Prints the chosen branch, returns 0 for yes.
# No answer available (stdin closed, e.g. a non-interactive run) takes the
# default rather than aborting the sync mid-file.
confirm_default_yes() {
  local prompt="$1" yes="$2" no="$3"
  local reply=""
  read -p "$prompt (Y/n): " -n 1 -r reply || true
  echo
  if [[ $reply =~ ^[Nn]$ ]]; then
    echo "$no"
    return 1
  fi
  echo "$yes"
  return 0
}
