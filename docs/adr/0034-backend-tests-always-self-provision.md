# Backend tests always self-provision testcontainers; `CI` leaves the test cache hash

Backend suites used to pick their infra at runtime. With `CI` unset on the primary
checkout they probed `localhost` for an already-running compose stack and skipped
schema provisioning; under `CI` — and in a linked worktree, which
`scripts/test.sh` forced to `CI=true` — they started throwaway testcontainers and
ran `drizzle-kit push`. Two paths, two behaviours, from one command.

The local path is the dishonest one. It runs against whatever state the dev
database happens to be in: a stale `pnpm db:push`, a half-finished manual edit,
another suite's leftovers. It also skips the provisioning step entirely, so the
step CI depends on was only ever exercised elsewhere — the failure mode
[ADR 0021](0021-test-schema-provisioning-db-push.md) was written to chase.
A local pass did not mean what a CI pass meant.

## Decision

**Delete the compose path.** Every backend suite starts its own Postgres and
Redis and pushes its own schema, on every run — primary checkout, worktree and CI
alike. Testcontainers binds random host ports, so nothing collides with the dev
stack on 5444/6379, and nothing reads from it.

What goes with it:

- `localPort` leaves the `InfraDescriptor` contract, along with the TCP port
  probe, the local resolver, and `inLinkedWorktree()`. `@acme/db/testing` drops
  the `DB_DEVELOPMENT_PROFILE.DB_PORT` it fed that field (it still imports the
  profile for `DB_USER`/`DB_NAME`, and `LOCAL_DB_PORT` stays in `@acme/db`'s
  config, scoped to dev infra); `@acme/redis/testing` drops its `localPort` the
  same way. `StartedInfra.container` is now required rather than "present only on
  the CI path".
- `scripts/push-test-schemas.sh` is deleted. It existed only to push the isolated
  `*_test` schemas into the dev database so the local path would find tables; the
  global-setup now does that per suite.

**`CI` comes out of the test tasks' turbo hash.** [`@acme/env` ADR 0001](../../packages/platform/env/docs/adr/0001-one-env-factory-per-slice.md) §3's
`VITEST` carve-out already means `CI` no longer changes env validation under
vitest. Once the infra branch goes, `CI` has no effect on test results at all —
so hashing it only splits one honest result across three partitions. `CI` is
removed from the `env` of `test`, `test:backend` and `test:frontend`, and stays in
`globalPassThroughEnv` for every other task. `scripts/test.sh` stops forcing
`CI=true` in a worktree. Local, worktree and CI runs now share one cache
partition — the reuse the old CI-mirroring scheme had to give up to stay
correct.

**The concurrency cap applies to every test run.** It used to be gated on
`CI=true`, on the reasoning that a local compose-backed run shared one Postgres
and could fan out freely. Every run now starts containers, so every run needs the
cap: `turbo run <task> --concurrency=${TEST_CONCURRENCY:-2}`. Every test entry
point routes through `scripts/test.sh` to inherit it, including the quality gate,
where `test` moves out of the batched `turbo run lint format typecheck`
invocation into its own wrapper-routed stage — the cap must reach `test` without
throttling the other three.

Watch tasks route through the wrapper too, but the wrapper exempts `*:watch` from
the cap. They are `persistent: true`, and turbo refuses to start more persistent
tasks than its concurrency allows, so capping them at 2 fails the run outright.
The cap would buy nothing anyway: a watcher starts its containers once and holds
them, rather than in waves.

**Ryuk is disabled by default on every run.** A rootless podman machine (the
macOS default) cannot bind-mount the docker socket the reaper needs, so it dies
before signalling ready and takes global-setup with it. Cleanup does not depend on
it: `stopInfra()` in the global teardown stops each container explicitly, and
isolation comes from testcontainers' random ports and generated names. The
default is set with `??=`, so an explicit outer value still wins — but nothing
sets one, CI included: a GitHub runner is torn down after the job, so the reaper
has nothing left to reap that the runner's own teardown doesn't. CI runs
reaper-less on purpose, not by omission.

**A missing container runtime fails once, usefully.** Global-setup probes the
runtime with `getContainerRuntimeClient()` before starting anything and throws one
error naming the fix, instead of one opaque socket error per descriptor per suite.

## Considered and rejected

- **Keep `CI` hashed as belt-and-braces.** It costs a 3× cache split to guard
  against a coupling that no longer exists. If something later makes `CI` change
  test behaviour, that is the thing to fix.
- **Gate Ryuk on `CI` instead of disabling it outright.** Keeps a
  reaper that works on exactly one of the three environments and a conditional to
  reason about, in exchange for a safety net that explicit teardown already
  covers.
- **Prebake the pushed schema into an image, or push into a template database.**
  The obvious answer to the cost below, and the wrong one: it reintroduces an
  artifact that can drift from `schema.ts`, which is the class of failure this
  ADR exists to kill.
- **A `TEST_INFRA_MODE` toggle** — moot once there is only one mode.
- **Cap the gate's single batched invocation instead of splitting `test` out.**
  One `turbo run lint format typecheck test --concurrency=2` would need no second
  invocation, but the cap is there for containers and would throttle lint, format
  and typecheck to two tasks at a time for the whole run. Splitting `test` off
  costs a foreground `build` prime — without which two concurrent `turbo run`
  invocations each build the graph — and buys back the uncapped batch.

## Status

accepted

## Consequences

- **Cold `pnpm test` at concurrency 2 takes ~2m02s** (34 turbo tasks, all green,
  nothing cached; M-series mac, 16 GB rootless podman machine, images already
  pulled). A re-run with no source changes is **FULL TURBO at ~3.5s** — 34/34
  replayed. The cost is real and was free locally before: each Postgres suite
  boots pgvector and pushes the full aggregated `nextjs` schema. We accept it. If
  a cold run becomes intolerable, revisit — but not with a prebaked artifact.
- **A container runtime is now a hard prerequisite for backend tests everywhere.**
  `pnpm infra:up` is no longer one; it is dev infra only. `podman machine start`
  is the whole setup.
- **Worktrees stop being special for tests.** No forced `CI`, no separate cache
  partition, no callout in `CLAUDE.md` / `AGENTS.md`. They still inherit the
  primary checkout's `.env` by symlink for build/run env, which
  `scripts/link-worktree-env.mjs` does in the `postinstall` chain.
- **Tests never touch the dev database.** A suite can no longer be broken by dev
  state, and `pnpm test` can no longer corrupt it.
- Raising `TEST_CONCURRENCY` past what the podman machine's memory and socket can
  hold is the failure mode to expect if someone tunes it — containers, not tests,
  are the constraint.
