#!/usr/bin/env bash
# Bring up local infra with provider-aware profile gating. The `infra` profile
# (postgres/redis/localstack/jaeger) is always on; the `ollama` profile is added
# only when a model provider is set to `ollama`, so non-Ollama setups never start
# (or wait on) the container. Run via `pnpm with-env` so LLM_PROVIDER /
# EMBED_PROVIDER are loaded from ./.env before this script reads them.
set -euo pipefail

profiles="infra"
if [ "${LLM_PROVIDER:-ollama}" = "ollama" ] || [ "${EMBED_PROVIDER:-ollama}" = "ollama" ]; then
  profiles="$profiles,ollama"
fi
export COMPOSE_PROFILES="$profiles"

exec ./scripts/compose.sh "$@"
