#!/usr/bin/env bash
# Fails fast when this machine is not pointed at the shared turbo cache.
#
# Runs as `predev`. The cache is self-hosted and shared with CI
# (docs/adr/0044-one-self-hosted-turbo-cache-for-ci-and-laptops.md), so there is
# no `turbo login` to do — turbo reads TURBO_API/TURBO_TOKEN/TURBO_TEAM from the
# environment, and they have to be exported by the shell rather than kept in a
# .env: `pnpm lint` and `pnpm typecheck` never go through `pnpm with-env`.
#
# Checked here rather than left to turbo because turbo's own failure is quiet.
# With TURBO_API unset it falls back to a default apiUrl of https://vercel.com
# and reports "remote caching disabled", which reads like a Vercel problem.
set -euo pipefail

fail() {
  echo ""
  echo "❌ $1"
  echo ""
  echo "Run the setup wizard, which provisions the cache and prints the exports:"
  echo "  ./scripts/wizards/turbo-cache-setup.sh"
  echo ""
  exit 1
}

[ -n "${TURBO_API:-}" ] || fail "TURBO_API is not set, so turbo would use Vercel instead of the shared cache."
[ -n "${TURBO_TOKEN:-}" ] || fail "TURBO_TOKEN is not set, so the shared cache will reject every request."
[ -n "${TURBO_TEAM:-}" ] || fail "TURBO_TEAM is not set; the cache namespaces artifacts by it."

# The same endpoint turbo hits once per run to decide whether caching is on, so
# a 200 here means a real `turbo run` will authenticate too.
status="$(
  curl -fsS -o /dev/null -w '%{http_code}' \
    --max-time 10 \
    -H "Authorization: Bearer ${TURBO_TOKEN}" \
    "${TURBO_API}/v8/artifacts/status?teamId=${TURBO_TEAM}" 2>/dev/null || true
)"

case "$status" in
200) exit 0 ;;
401 | 403)
  fail "The shared cache at ${TURBO_API} rejected TURBO_TOKEN (HTTP ${status}).
   The token here and the one the worker holds disagree. Re-put the worker's:
     printf '%s' \"\$TURBO_TOKEN\" | pnpm wrangler secret put TURBO_TOKEN"
  ;;
000 | "")
  # Near-always a just-deployed worker whose TLS certificate has not been
  # issued yet: DNS resolves, TCP connects, and the handshake fails with no
  # certificate offered. Re-running the wizard does nothing for that.
  fail "Could not reach the shared cache at ${TURBO_API}.
   If you deployed it in the last few minutes, the TLS certificate is probably
   still being issued — wait and re-run this script. Confirm with:
     curl -sS -o /dev/null -w '%{http_code}\\n' ${TURBO_API}/v8/artifacts/status
   A 401 means it is live (the endpoint requires the token); an SSL handshake
   failure means the certificate is still pending."
  ;;
*) fail "The shared cache at ${TURBO_API} answered HTTP ${status}, expected 200." ;;
esac
