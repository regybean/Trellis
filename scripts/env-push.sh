#!/usr/bin/env bash
set -euo pipefail

# Resolve paths and load wiring + the selected backend adapter.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=../secrets.config.sh
source "$REPO_ROOT/secrets.config.sh"
adapter="$SCRIPT_DIR/secrets-backends/${SECRETS_BACKEND}.sh"
if [ ! -f "$adapter" ]; then
  echo "Unknown SECRETS_BACKEND '$SECRETS_BACKEND' (no $adapter)" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$adapter"

# Build the JSON to push: ONLY sensitive keys. A key is sensitive when it is
# declared empty in <file>.example and is not a NEXT_PUBLIC_ var. Non-sensitive
# keys never leave the repo. Keys present locally but not declared in the example
# are skipped with a warning (the example is authoritative).
build_sensitive_json() {
  local env_file="$1"
  local example_file="${env_file}.example"

  if [ ! -f "$example_file" ]; then
    echo "ERROR: $example_file is required to classify which keys are secret" >&2
    return 1
  fi

  EXAMPLE_FILE="$example_file" ENV_FILE="$env_file" node -e '
const fs = require("fs");

function parse(file) {
  const env = {};
  for (let line of fs.readFileSync(file, "utf8").split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let key = m[1], val = m[2];
    if (val.match(/^"(.*)"$/)) {
      val = val.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
    }
    env[key] = val;
  }
  return env;
}

const example = parse(process.env.EXAMPLE_FILE);
const local = fs.existsSync(process.env.ENV_FILE) ? parse(process.env.ENV_FILE) : {};

const isSecret = k => !k.startsWith("NEXT_PUBLIC_") && example[k] === "";

const out = {};
for (const [k, v] of Object.entries(local)) {
  if (!(k in example)) {
    process.stderr.write(`⚠️  ${k} is set in ${process.env.ENV_FILE} but not declared in ${process.env.EXAMPLE_FILE} — skipping (not pushed)\n`);
    continue;
  }
  if (isSecret(k)) out[k] = v;   // sensitive -> push; non-sensitive stays in the repo
}
process.stdout.write(JSON.stringify(out, null, 2));
'
}

# Get keys from existing secret
get_secret_keys() {
  local secret_id="$1"
  fetch_secret "$secret_id" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const e=JSON.parse(d);Object.keys(e).forEach(k=>console.log(k));}catch(err){}})'
}

# Push one env file to secret
push_env_file() {
  local env_file="$1"
  local secret_id="$2"

  echo "Pushing $env_file -> $secret_id"

  if [ ! -f "$env_file" ]; then
    echo "ERROR: $env_file does not exist"
    return 1
  fi

  # Sensitive-only JSON (see build_sensitive_json)
  local new_json
  new_json=$(build_sensitive_json "$env_file")

  # Get keys from new JSON
  local new_keys
  new_keys=$(echo "$new_json" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const e=JSON.parse(d);Object.keys(e).forEach(k=>console.log(k))})')

  # Get existing keys from secret
  local existing_keys
  existing_keys=$(get_secret_keys "$secret_id")

  # Check for keys that would be deleted and merge if needed
  local should_merge=false
  local should_update=true
  if [ -n "$existing_keys" ]; then
    local deleted_keys=""
    local different_keys=""

    # Check for deleted keys (remote only)
    for key in $existing_keys; do
      if ! echo "$new_keys" | grep -qx "$key"; then
        deleted_keys="$deleted_keys$key\n"
      fi
    done

    # Check for different values in common keys
    local existing_json
    existing_json=$(fetch_secret "$secret_id")

    for key in $new_keys; do
      if echo "$existing_keys" | grep -qx "$key"; then
        local local_val
        local remote_val
        local_val=$(echo "$new_json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const e=JSON.parse(d);console.log(e['$key']||'');})")
        remote_val=$(echo "$existing_json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const e=JSON.parse(d);console.log(e['$key']||'');})")

        if [ "$local_val" != "$remote_val" ]; then
          different_keys="$different_keys$key\n"
        fi
      fi
    done

    # Show deleted keys prompt
    if [ -n "$deleted_keys" ]; then
      echo ""
      echo "ℹ️  The following keys exist in secret '$secret_id' but NOT in $env_file:"
      echo -e "$deleted_keys" | grep -v '^$' | sed 's/^/  - /'
      read -p "Would you like to KEEP these remote keys? (Y/n): " -n 1 -r
      echo
      if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo "Will overwrite and remove remote-only keys"
        should_merge=false
      else
        echo "Will keep remote-only keys"
        should_merge=true
      fi
    fi

    # Show different values prompt
    if [ -n "$different_keys" ]; then
      echo ""
      echo "⚠️  The following keys have different values between local and remote:"
      for key in $(echo -e "$different_keys" | grep -v '^$'); do
        local local_val
        local remote_val
        local_val=$(echo "$new_json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const e=JSON.parse(d);console.log(e['$key']||'');})")
        remote_val=$(echo "$existing_json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const e=JSON.parse(d);console.log(e['$key']||'');})")
        echo "  $key"
        echo "    Local:  $local_val"
        echo "    Remote: $remote_val"
      done
      read -p "Overwrite remote values with local? (Y/n): " -n 1 -r
      echo
      if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo "Will keep remote values for differing keys"
        should_update=false
      else
        echo "Will update to local values"
      fi
    fi
  fi

  # Prepare final JSON
  local final_json
  if [ "$should_merge" = true ] || [ "$should_update" = false ]; then
    # Merge or keep remote values: combine local and remote appropriately
    local existing_json
    existing_json=$(fetch_secret "$secret_id")

    if [ "$should_update" = true ]; then
      # Update common keys with local values, keep remote-only keys
      final_json=$(echo "$new_json" | node -e '
const existingKeys = process.argv[1].split("\n").filter(k => k);
const secretJson = process.argv[2];
let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", c => data += c);
process.stdin.on("end", () => {
  const newEnv = JSON.parse(data);
  const existing = JSON.parse(secretJson);
  const merged = { ...newEnv };

  // Add remote-only keys
  for (const key of existingKeys) {
    if (!(key in merged) && key in existing) {
      merged[key] = existing[key];
    }
  }

  console.log(JSON.stringify(merged));
});
' "$existing_keys" "$existing_json")
    else
      # Keep remote values for common keys, add new local keys
      final_json=$(echo "$new_json" | node -e '
const existingKeys = process.argv[1].split("\n").filter(k => k);
const secretJson = process.argv[2];
let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", c => data += c);
process.stdin.on("end", () => {
  const newEnv = JSON.parse(data);
  const existing = JSON.parse(secretJson);
  const merged = { ...existing };

  // Add new local keys only
  for (const key in newEnv) {
    if (!(key in existing)) {
      merged[key] = newEnv[key];
    }
  }

  console.log(JSON.stringify(merged));
});
' "$existing_keys" "$existing_json")
    fi
  else
    # Overwrite: only use keys from local file
    final_json=$(echo "$new_json" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(JSON.stringify(JSON.parse(d))))')
  fi

  # Persist via the backend adapter (owns create-or-update)
  printf '%s' "$final_json" | put_secret "$secret_id"

  echo "✓ Pushed to $secret_id"
}

# Process each env file declared in SECRET_MAP (see secrets.config.sh)
for entry in "${SECRET_MAP[@]}"; do
  push_env_file "${entry#*:}" "${entry%%:*}"
done

echo ""
echo "All environment files pushed successfully!"
