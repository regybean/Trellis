#!/usr/bin/env bash
# Template for secrets.config.sh — the wiring env:pull / env:push need.
#
#   cp secrets.config.example.sh secrets.config.sh
#
# Then edit SECRET_MAP below for your own env files. The copy is committed and
# NON-SECRET: it maps secret *names* to file paths and holds no values, so it is
# safe to read in a public repo. Only the .env files it names carry secrets, and
# .gitignore already excludes those.
#
# This template ships; secrets.config.sh does not. The mapping is one line per
# env file you keep in a vault, which is a list only your repo knows.

# Which adapter to use, from scripts/secrets-backends/<name>.sh.
# This CANNOT live in .env — that's the file we fetch (chicken-and-egg) — so it
# lives here. There is deliberately NO default: pick a backend explicitly via the
# SECRETS_BACKEND env var. `localstack` (dev/demo, against the always-on infra
# LocalStack) or `aws` (a real cloud vault) are the shipped examples; add your own
# by dropping a file next to them (see scripts/secrets-backends/_template.sh).
SECRETS_BACKEND="${SECRETS_BACKEND:-}"

# Maps a secret name (as known to your backend) -> the local .env file it fills.
# Format: "secret-name:path/to/.env". The matching template is "<path>.example",
# which is the source of truth for which keys are secret (empty value = secret) —
# so every path named here needs a committed `.example` beside it.
SECRET_MAP=(
  # The local dev stack's own env, read by `pnpm with-env`. Present whenever you
  # took the `infra` bundle.
  "infra:deploy/.env"
  # One line per app. The secret name is yours to choose; these use the app
  # directory name, which keeps the mapping readable in a vault listing.
  # "my-app:apps/my-app/.env"
)
