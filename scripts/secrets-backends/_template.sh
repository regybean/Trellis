#!/usr/bin/env bash
# Secrets backend adapter — CONTRACT / TEMPLATE.
#
# To add your own backend: copy this file to scripts/secrets-backends/<name>.sh,
# implement the two functions below, then select it with SECRETS_BACKEND=<name>
# (see secrets.config.sh). Adding a backend = dropping a file here. There is
# nothing shared to edit and nothing to register.
#
# Each adapter OWNS its own auth (login checks, tokens, profiles, etc.).
#
#   fetch_secret <name>
#     Print the secret as a single JSON object to stdout.
#       missing secret     -> print "{}" and exit 0
#       auth/network error -> message to stderr, exit non-zero
#
#   put_secret <name>
#     Read a JSON object from STDIN and persist it under <name>.
#     Own create-or-update: create the secret if it does not exist.
#       auth/network error -> message to stderr, exit non-zero

fetch_secret() {
  local name="$1"
  echo "secrets backend '_template' is not implemented" >&2
  return 1
}

put_secret() {
  local name="$1"
  echo "secrets backend '_template' is not implemented" >&2
  return 1
}
