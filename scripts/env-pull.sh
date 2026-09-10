#!/usr/bin/env bash
# Fetch each env file's secrets from the selected backend and rebuild the file:
# non-secret values from <file>.example, secrets from the vault.
#
# This script is the entry point and the prompts. What to write is decided by
# @acme/secrets-sync — see scripts/lib/secrets-env.sh.
set -euo pipefail

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/secrets-env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/secrets-env.sh"

WORK="$(secrets_workdir)"
trap 'rm -rf "$WORK"' EXIT

sync_env_file() {
  local secret_id="$1"
  local target_file="$2"
  local example_file="${target_file}.example"

  echo "Composing $secret_id -> $target_file"

  fetch_secret "$secret_id" > "$WORK/vault.json"

  # What the file would gain and lose, each block rendered ready to print.
  secrets_sync plan-pull \
    --example "$example_file" \
    --env "$target_file" \
    --vault "$WORK/vault.json" \
    --extras-out "$WORK/extras" \
    --differing-out "$WORK/differing"

  local keep_extra=""
  local prefer_remote="--prefer-source"

  if [ -s "$WORK/extras" ]; then
    echo ""
    echo "ℹ️  The following keys exist in $target_file but NOT in secret '$secret_id':"
    cat "$WORK/extras"
    if confirm_default_yes "Would you like to KEEP these local keys?" \
      "Will keep local-only keys" "Will overwrite and remove local-only keys"; then
      keep_extra="--keep-extra"
    fi
  fi

  if [ -s "$WORK/differing" ]; then
    echo ""
    echo "⚠️  The following keys have different values between local and remote:"
    cat "$WORK/differing"
    if ! confirm_default_yes "Overwrite local values with remote?" \
      "Will update to remote values" "Will keep local values for differing keys"; then
      prefer_remote=""
    fi
  fi

  # Write through a temp file so an interrupted run cannot truncate the .env.
  local tmp_file="$target_file.$$"
  # shellcheck disable=SC2086  # the two flags are deliberately word-split.
  secrets_sync apply-pull \
    --example "$example_file" \
    --env "$target_file" \
    --vault "$WORK/vault.json" \
    $keep_extra $prefer_remote > "$tmp_file"
  mv -f "$tmp_file" "$target_file"

  echo "✓ Updated $target_file"
}

# Process each env file declared in SECRET_MAP (see secrets.config.sh)
for entry in "${SECRET_MAP[@]}"; do
  sync_env_file "${entry%%:*}" "${entry#*:}"
done

echo ""
echo "All environment files synced successfully!"
