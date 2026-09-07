#!/usr/bin/env bash
# Push each env file's secrets to the selected backend. ONLY sensitive keys
# travel: a key is sensitive when <file>.example declares it empty and it is not
# a NEXT_PUBLIC_ var (ADR 0001). Non-secret config never leaves the repo.
#
# This script is the entry point and the prompts. What to send is decided by
# @acme/secrets-sync — see scripts/lib/secrets-env.sh.
set -euo pipefail

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/secrets-env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/secrets-env.sh"

WORK="$(secrets_workdir)"
trap 'rm -rf "$WORK"' EXIT

push_env_file() {
  local env_file="$1"
  local secret_id="$2"
  local example_file="${env_file}.example"

  echo "Pushing $env_file -> $secret_id"

  if [ ! -f "$env_file" ]; then
    echo "ERROR: $env_file does not exist" >&2
    return 1
  fi

  # The sensitive-only payload, and the secret as it stands today.
  secrets_sync payload-push --example "$example_file" --env "$env_file" > "$WORK/local.json"
  fetch_secret "$secret_id" > "$WORK/remote.json"

  local keep_extra=""
  local prefer_local="--prefer-source"

  secrets_sync plan-push \
    --local "$WORK/local.json" \
    --remote "$WORK/remote.json" \
    --extras-out "$WORK/extras" \
    --differing-out "$WORK/differing"

  if [ -s "$WORK/extras" ]; then
    echo ""
    echo "ℹ️  The following keys exist in secret '$secret_id' but NOT in $env_file:"
    cat "$WORK/extras"
    if confirm_default_yes "Would you like to KEEP these remote keys?" \
      "Will keep remote-only keys" "Will overwrite and remove remote-only keys"; then
      keep_extra="--keep-extra"
    fi
  fi

  if [ -s "$WORK/differing" ]; then
    echo ""
    echo "⚠️  The following keys have different values between local and remote:"
    cat "$WORK/differing"
    if ! confirm_default_yes "Overwrite remote values with local?" \
      "Will update to local values" "Will keep remote values for differing keys"; then
      prefer_local=""
    fi
  fi

  # Persist via the backend adapter (owns create-or-update).
  # shellcheck disable=SC2086  # the two flags are deliberately word-split.
  secrets_sync apply-push \
    --local "$WORK/local.json" \
    --remote "$WORK/remote.json" \
    $keep_extra $prefer_local | put_secret "$secret_id"

  echo "✓ Pushed to $secret_id"
}

# Process each env file declared in SECRET_MAP (see secrets.config.sh)
for entry in "${SECRET_MAP[@]}"; do
  push_env_file "${entry#*:}" "${entry%%:*}"
done

echo ""
echo "All environment files pushed successfully!"
