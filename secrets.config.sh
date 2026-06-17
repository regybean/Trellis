#!/usr/bin/env bash
# Wiring for env:pull / env:push. Committed and NON-SECRET — values here are
# safe to read in a public repo. Both scripts source this file.

# Which adapter to use, from scripts/secrets-backends/<name>.sh.
# This CANNOT live in .env — that's the file we fetch (chicken-and-egg) — so it
# lives here. There is deliberately NO default: pick a backend explicitly via the
# SECRETS_BACKEND env var. `localstack` (dev/demo, against the always-on infra
# LocalStack) or `aws` (a real cloud vault) are the shipped examples.
SECRETS_BACKEND="${SECRETS_BACKEND:-}"

# Maps a secret name (as known to your backend) -> the local .env file it fills.
# Format: "secret-name:path/to/.env". The matching template is "<path>.example",
# which is the source of truth for which keys are secret (empty value = secret).
SECRET_MAP=(
  "app-shared:.env"
  "nextjs:apps/nextjs/.env"
  "tanstack-start:apps/tanstack-start/.env"
)
