#!/usr/bin/env bash
# Test entry wrapper. Every root test script routes through here so the
# concurrency cap below applies to every one-shot test run. See ADR 0034.
#
# `CI` is deliberately *not* set or read here: backend suites always
# self-provision testcontainers, and ADR 0022's `VITEST` carve-out means `CI` no
# longer changes env validation under vitest. So `CI` has no effect on test
# results, is not in the test tasks' turbo hash, and local/worktree/CI runs share
# one cache partition.
set -euo pipefail

export NEXT_PUBLIC_WEBAPP="${NEXT_PUBLIC_WEBAPP:-nextjs}"

task="${1:-test}"
[ "$#" -gt 0 ] && shift

# Watch tasks are `persistent: true` in turbo.json, and turbo refuses to start
# more persistent tasks than its concurrency allows. They also start their
# containers once and hold them, rather than in waves, so the cap buys nothing.
# Run them uncapped.
case "$task" in
*:watch)
  exec turbo run "$task" "$@"
  ;;
esac

# Backend suites self-provision a Postgres (+Redis) testcontainer each in their
# global-setup. Turbo's default fan-out (concurrency 10) would spin up every
# feature's containers at once — enough Postgres instances to exhaust the podman
# machine's memory/socket. Cap parallelism so containers come up in waves.
exec turbo run "$task" --concurrency="${TEST_CONCURRENCY:-2}" "$@"
