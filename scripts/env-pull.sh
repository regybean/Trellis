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

# Get existing keys from a file
get_existing_keys() {
  local file="$1"
  [ ! -f "$file" ] && return
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$file" | cut -d= -f1 || true
}

# Get value for a specific key from env file
get_env_value() {
  local file="$1"
  local key="$2"
  grep "^${key}=" "$file" 2>/dev/null | head -n1 | cut -d= -f2- | sed 's/^"\(.*\)"$/\1/' || echo ""
}

# Compose the desired env as JSON: non-sensitive values come from <file>.example,
# sensitive keys (empty in the example, non-NEXT_PUBLIC_) are filled from the vault.
# The example is the source of truth for which keys exist and which are secret.
compose_desired_json() {
  local name="$1"
  local target_file="$2"
  local example_file="${target_file}.example"

  local vault_json
  vault_json=$(fetch_secret "$name")

  if [ ! -f "$example_file" ]; then
    echo "⚠️  No $example_file found; using vault values only." >&2
    printf '%s' "$vault_json"
    return 0
  fi

  EXAMPLE_FILE="$example_file" node -e '
const fs = require("fs");
let raw = ""; process.stdin.setEncoding("utf8");
process.stdin.on("data", c => raw += c);
process.stdin.on("end", () => {
  const vault = JSON.parse(raw || "{}");
  const lines = fs.readFileSync(process.env.EXAMPLE_FILE, "utf8").split("\n");
  const out = {};
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (val.match(/^"(.*)"$/)) val = val.slice(1, -1);
    const isPublic = key.startsWith("NEXT_PUBLIC_");
    if (val !== "" || isPublic) {
      out[key] = val;                                                  // non-sensitive
    } else {
      out[key] = vault[key] !== undefined ? String(vault[key]) : "";   // sensitive -> vault
    }
  }
  process.stdout.write(JSON.stringify(out));
});
' <<< "$vault_json"
}

# Fetch and write one env file
sync_env_file() {
  local secret_id="$1"
  local target_file="$2"

  echo "Composing $secret_id -> $target_file"

  # Desired env = example (non-sensitive) merged with vault (sensitive)
  local json
  json=$(compose_desired_json "$secret_id" "$target_file")

  # Get keys from secret
  local secret_keys
  secret_keys=$(echo "$json" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const e=JSON.parse(d);Object.keys(e).forEach(k=>console.log(k));})')

  # Check for keys that would be lost and extra keys to keep
  local should_merge=false
  local should_update=true
  if [ -f "$target_file" ]; then
    local existing_keys
    existing_keys=$(get_existing_keys "$target_file")

    local missing_keys=""
    local different_keys=""

    # Check for missing keys (local only)
    for key in $existing_keys; do
      if ! echo "$secret_keys" | grep -qx "$key"; then
        missing_keys="$missing_keys$key\n"
      fi
    done

    # Check for different values in common keys
    for key in $secret_keys; do
      if echo "$existing_keys" | grep -qx "$key"; then
        local local_val
        local remote_val
        local_val=$(get_env_value "$target_file" "$key")
        remote_val=$(echo "$json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const e=JSON.parse(d);console.log(e['$key']||'');})")

        if [ "$local_val" != "$remote_val" ]; then
          different_keys="$different_keys$key\n"
        fi
      fi
    done

    # Show missing keys prompt
    if [ -n "$missing_keys" ]; then
      echo ""
      echo "ℹ️  The following keys exist in $target_file but NOT in secret '$secret_id':"
      echo -e "$missing_keys" | grep -v '^$' | sed 's/^/  - /'
      read -p "Would you like to KEEP these local keys? (Y/n): " -n 1 -r
      echo
      if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo "Will overwrite and remove local-only keys"
        should_merge=false
      else
        echo "Will keep local-only keys"
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
        local_val=$(get_env_value "$target_file" "$key")
        remote_val=$(echo "$json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const e=JSON.parse(d);console.log(e['$key']||'');})")
        echo "  $key"
        echo "    Local:  $local_val"
        echo "    Remote: $remote_val"
      done
      read -p "Overwrite local values with remote? (Y/n): " -n 1 -r
      echo
      if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo "Will keep local values for differing keys"
        should_update=false
      else
        echo "Will update to remote values"
      fi
    fi
  fi

  # Convert JSON to .env format and write atomically
  local tmpFile="$target_file.$$"

  if [ "$should_merge" = true ] || [ "$should_update" = false ]; then
    # Merge or keep local values: combine remote and local appropriately
    {
      if [ "$should_update" = true ]; then
        # Update common keys with remote values, keep local-only keys
        echo "$json" | node -e '
let data = ""; process.stdin.setEncoding("utf8");
process.stdin.on("data", c => data += c);
process.stdin.on("end", () => {
  const env = JSON.parse(data);
  for (const [k, v] of Object.entries(env)) {
    let s = String(v);
    if (/^[A-Za-z0-9_./:-]*$/.test(s)) {
      console.log(`${k}=${s}`);
    } else {
      s = s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n");
      console.log(`${k}="${s}"`);
    }
  }
});
'
      else
        # Keep local values for common keys, add new remote keys
        if [ -f "$target_file" ]; then
          # Output all local keys first (preserving local values)
          cat "$target_file" | grep -E '^[A-Za-z_][A-Za-z0-9_]*='
        fi
        # Add new keys from remote that don't exist locally
        local existing_keys
        existing_keys=$(get_existing_keys "$target_file")
        echo "$json" | node -e "
const existingKeys = process.argv[1].split('\n').filter(k => k);
let data = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', c => data += c);
process.stdin.on('end', () => {
  const env = JSON.parse(data);
  for (const [k, v] of Object.entries(env)) {
    if (!existingKeys.includes(k)) {
      let s = String(v);
      if (/^[A-Za-z0-9_./:-]*\$/.test(s)) {
        console.log(\`\${k}=\${s}\`);
      } else {
        s = s.replace(/\\\\/g, '\\\\\\\\').replace(/\"/g, '\\\\\"').replace(/\\n/g, '\\\\n');
        console.log(\`\${k}=\"\${s}\"\`);
      }
    }
  }
});
" "$existing_keys"
      fi

      # Append local-only keys if merging
      if [ "$should_merge" = true ] && [ -f "$target_file" ]; then
        while IFS= read -r line; do
          if [[ $line =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]]; then
            local key="${BASH_REMATCH[1]}"
            if ! echo "$secret_keys" | grep -qx "$key"; then
              echo "$line"
            fi
          fi
        done < "$target_file"
      fi
    } > "$tmpFile"
  else
    # Overwrite: only use keys from secret
    echo "$json" | node -e '
let data = ""; process.stdin.setEncoding("utf8");
process.stdin.on("data", c => data += c);
process.stdin.on("end", () => {
  const env = JSON.parse(data);
  for (const [k, v] of Object.entries(env)) {
    let s = String(v);
    if (/^[A-Za-z0-9_./:-]*$/.test(s)) {
      console.log(`${k}=${s}`);
    } else {
      s = s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n");
      console.log(`${k}="${s}"`);
    }
  }
});
' > "$tmpFile"
  fi

  mv -f "$tmpFile" "$target_file"
  echo "✓ Updated $target_file"
}

# Process each env file declared in SECRET_MAP (see secrets.config.sh)
for entry in "${SECRET_MAP[@]}"; do
  sync_env_file "${entry%%:*}" "${entry#*:}"
done

echo ""
echo "All environment files synced successfully!"
