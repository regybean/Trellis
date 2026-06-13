#!/usr/bin/env bash
# Default backend: stores each secret as a gitignored JSON file under secrets/.
# Zero cloud setup — good for solo dev and the simplest reference implementation
# of the adapter contract (see _template.sh).

fetch_secret() {
  local name="$1"
  cat "secrets/${name}.json" 2>/dev/null || echo "{}"
}

put_secret() {
  local name="$1"
  mkdir -p secrets
  cat > "secrets/${name}.json"
}
