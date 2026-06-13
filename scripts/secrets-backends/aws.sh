#!/usr/bin/env bash
# AWS Secrets Manager backend — the worked example of the adapter contract.
# Each secret is stored as a JSON string keyed by its name.
#
# Uses the standard AWS credential/region resolution (env vars, shared
# config/credentials, instance role, ...). Configure it the normal way:
#   AWS_PROFILE / AWS_REGION / AWS_ACCESS_KEY_ID / ...
# To point it at LocalStack, also export:
#   AWS_ENDPOINT_URL=http://localhost:4566   (honored natively by the AWS CLI)

fetch_secret() {
  local name="$1" out
  if out=$(aws secretsmanager get-secret-value \
        --secret-id "$name" --query SecretString --output text 2>&1); then
    printf '%s\n' "$out"
  elif printf '%s' "$out" | grep -q 'ResourceNotFoundException'; then
    echo "{}"                       # missing secret -> {} exit 0
  else
    printf '%s\n' "$out" >&2         # real error -> stderr, non-zero
    return 1
  fi
}

put_secret() {
  local name="$1" json
  json=$(cat)
  # Own create-or-update: put-secret-value fails if the secret is absent.
  if aws secretsmanager describe-secret --secret-id "$name" > /dev/null 2>&1; then
    aws secretsmanager put-secret-value \
      --secret-id "$name" --secret-string "$json" > /dev/null
  else
    aws secretsmanager create-secret \
      --name "$name" --secret-string "$json" > /dev/null
  fi
}
