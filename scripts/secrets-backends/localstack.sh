#!/usr/bin/env bash
# LocalStack backend — the dev/demo example of the adapter contract.
#
# It IS the `aws` adapter, pre-pointed at the LocalStack Secrets Manager that
# `pnpm infra:up` already runs (compose service `localstack`, port 4566). This
# is the one-variable opt-in: `SECRETS_BACKEND=localstack` and nothing else to
# configure — no real cloud account, no credentials to source.
#
# Its only job is to demonstrate that the pluggable sync works against a real
# external vault. LocalStack state is ephemeral (wiped when the container is
# recreated), so re-run `pnpm env:push` after a fresh `pnpm infra:up` to seed it.
#
# For a real cloud vault, use `SECRETS_BACKEND=aws` instead and configure the
# standard AWS credential chain (see aws.sh).

# LocalStack ignores credential *values* but the AWS CLI still requires them to
# be present — these dummies satisfy it. The endpoint matches the compose service.
export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

# Reuse the AWS Secrets Manager adapter verbatim — fetch_secret / put_secret.
source "$(dirname "${BASH_SOURCE[0]}")/aws.sh"
