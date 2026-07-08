# Test-infra mode follows `CI`; worktrees mirror CI; the Turbo cache is partitioned on `CI`

Backend tests branch on `process.env.CI` in two places — infra provisioning
(`@acme/test-utils` global-setup: `CI` → throwaway testcontainers + fresh
migrations; unset → probe an already-running compose stack, skip migrations) and
`env.ts` `skipValidation` (`!!process.env.CI`, in ~10 packages). Both paths run
from the **same** command (`pnpm test` → `turbo run test`). Because `CI` lived
only in `globalPassThroughEnv` (passed through but **not hashed**), the `test`
and `test:backend` cache keys were identical in CI and locally. With remote
caching on ([turbo.json](../../turbo.json) `remoteCache`), a local pass (compose,
migrations skipped, env validated) produced an artifact CI **replayed on a cache
hit** — so the testcontainers + fresh-migration path never actually executed in
CI. Drift that breaks CI but not local (a broken migration, a leaked-state
cleanup bug, an image-version or env-shape mismatch) was masked.

We fix this with a **single switch** rather than a new toggle:

1. **`CI` is added to the `env` (hash inputs) of the `test`, `test:backend` and
   `test:frontend` tasks** in `turbo.json` — so the two behavioural worlds get
   distinct cache keys and can never replay across the boundary. `CI` stays in
   `globalPassThroughEnv` for every other task (we do **not** want `build` /
   `lint` cache to split on `CI`). `test:frontend` has no infra branch, but the
   wrapper forces `CI=true` for _all_ worktree test runs, so hashing it there too
   keeps its `skipValidation` behaviour honestly partitioned (the split is wasted
   reuse, never incorrect).
2. **Git worktrees export `CI=true` for the test run** via a `scripts/test.sh`
   wrapper that every root test script routes through (`test`, `test:nextjs`,
   `test:backend`, `test:frontend`). Detection is `[ -f .git ]`: a linked
   worktree's `.git` is a file (gitlink), the primary checkout's is a directory.
   A worktree lives on the same host as the primary checkout, so
   `localhost:5432/6379` _is_ main's running compose stack — a worktree test
   would otherwise silently share main's infra. Forcing `CI=true` makes a
   worktree a **true mirror of CI**: it self-provisions isolated testcontainers
   (no `pnpm infra:up` needed) and takes the same `skipValidation` path, on
   **every** axis, not just infra.
3. **A runtime fallback in `@acme/test-utils`** (`inLinkedWorktree()`, the Node
   counterpart to `[ -f .git ]`) makes a _direct_ per-package `vitest` run — one
   that bypasses the wrapper, e.g. `pnpm --filter <pkg> test:backend` — still
   choose testcontainers in a worktree. That path bypasses turbo entirely, so
   there is no cache key to partition; only the runtime infra choice matters.

The primary checkout keeps `CI` unset → compose + real env validation, its own
cache partition. Real CI gets `CI=true` from GitHub automatically. Worktree and
CI now share the `CI=true` partition legitimately, because they run the
identical path.

## Considered and rejected

- **A new `TEST_INFRA_MODE` (testcontainers|compose) decoupled from `CI`.**
  Rejected: it only partitions the _infra_ axis. `skipValidation` also keys on
  raw `CI` across ~10 `env.ts` files, so a worktree on testcontainers with `CI`
  unset would validate env while CI skips it — a second masking channel between
  worktree and CI, plus churn across the env contract ([ADR 0014](0014-tests-validate-real-env.md))
  and the test that stubs `CI`. The single switch closes both channels with zero
  change to any `env.ts` and no change to the `CI` branch itself (only the small
  `inLinkedWorktree()` runtime fallback is added, for the wrapper-less path). The
  one thing `TEST_INFRA_MODE` bought —
  reproducing the CI infra path on the primary checkout — is served instead by
  spinning up a worktree.
- **Disable caching for backend tests (`cache: false`).** Removes the masking
  but throws away all reuse; the point is a _correct_ cache, not no cache.
- **Always use testcontainers, everywhere.** Rejected: the primary checkout
  deliberately reuses the running compose stack for fast local iteration
  ([ADR 0017](0017-test-infra-owned-by-infra-package.md)).

## Status

accepted

## Consequences

- Worktree backend tests require a container runtime reachable by testcontainers
  (the podman socket) — the same prerequisite CI has. No `pnpm infra:up` in a
  worktree. On a **rootless podman machine** (the macOS default) the testcontainers
  Ryuk reaper can't start — SELinux in the VM denies its unrelabeled socket bind
  mount, so it exits before signalling ready and every backend run dies in
  global-setup. Set `TESTCONTAINERS_RYUK_DISABLED=true` at the host level (it is
  already in `turbo.json` `globalPassThroughEnv`, so it reaches the test workers).
  Isolation between parallel worktrees is unaffected — it comes from testcontainers'
  random host ports + generated names, not Ryuk — and orphan cleanup is covered by
  the global-setup's explicit `stopInfra()` teardown. Ryuk only works here if the
  machine is switched to rootful (`podman machine set --rootful`), which stops
  existing rootless containers, so it is not required.
- All three test tasks split their cache on `CI`, so the frontend portion
  re-runs across the main↔worktree boundary — wasted reuse, never incorrect.
- A raw `turbo run test:backend` (bypassing both the pnpm script and the wrapper)
  in a worktree would not get `CI=true` injected. The `inLinkedWorktree()`
  fallback still selects testcontainers at runtime, but that invocation's turbo
  hash would not be partitioned — an accepted edge, since normal use goes through
  the pnpm scripts.
- Worktrees also need **build/run** env, not just test infra: `.env` is gitignored so it
  never branches in. A linked worktree inherits the primary checkout's `.env` +
  `apps/*/.env` by symlink (`scripts/link-worktree-env.mjs`, in `postinstall`). See
  [ADR 0022](0022-centralized-env-validation-policy.md).
