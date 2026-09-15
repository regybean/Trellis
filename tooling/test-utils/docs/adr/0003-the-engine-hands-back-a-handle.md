# The engine hands back a handle; nothing about a run lives in module scope

**Status:** accepted

`startInfra` returns an `InfraHandle` — the repo root it resolved, the merged
`process.env` contribution of the containers it started, and a `stop()` that
stops them. The caller holds it. Two calls in one process are two independent
sets of containers.

That is a change of owner, not of behaviour. The engine used to resolve the
monorepo root into a `const` at import, keep its started containers in a
module-level `let`, and expose a matching `stopInfra()` that read the `let` back.
The global-setup called one and then the other, which worked, and has a cost the
first line of a test finds: a second `startInfra` in one process is not a second
construction. It silently overwrites the first call's containers, so the first
call's `stopInfra()` can no longer reach them, and no test can have two.

The consequence was that this file had no tests. Not one — while every backend
suite in the repo went through it. A root resolved at import is a value no caller
can supply and no test can vary; a registry in module scope makes each test order-
dependent on the last; and the reaper toggle went straight into `process.env`
with no return value, so even the decision it encodes was unobservable. Each of
those is one line, and together they are the whole reason.

## Decision

**One `startInfra` call owns everything that call produced.**

- The handle carries `repoRoot`, `env` and `stop()`. `stop()` empties the
  handle's own list, so a second call does nothing — the property `stopInfra()`
  had, kept where it can be asserted.
- `stopInfra()` is deleted rather than kept as a wrapper. A module-level function
  that stops "the" containers is exactly the singleton this removes, and the only
  caller was the global-setup.
- `pushDatabaseSchemas(targetSchema, repoRoot)` takes the root from the handle
  whose Postgres it is provisioning. It used to read the same import-time
  constant, which made two resolutions of one value that no caller could keep
  consistent.
- **The decisions come out as functions over values.** `containerPlan` returns
  what the engine would build from a descriptor — the `mode` and `waitLogTimes`
  defaults, the compiled wait pattern, the repo-relative mount resolution, and
  `command`/`startupTimeoutMs` left absent when the descriptor gives none.
  `ryukDisabled` returns the reaper value a run should use. `findRepoRoot` and
  `findPushApp` take the directory they read from. None of them starts anything,
  so all of them are assertable.
- **An empty descriptor set skips the runtime probe.** Nothing to start is
  nothing for an unreachable runtime to break, and nothing for the probe to say.
  A suite that names infra still fails once, up front, with the message naming
  the fix.

`backendProject` is untouched. It is the seam every package's
`vitest.config.backend.ts` is written against, and none of this reaches it.

## What the tests are, and what they are not

The suite drives the engine with descriptor sets that start nothing, plus
throwaway directory trees in a temp dir for the two functions that read disk. So
it needs no container runtime — which is the point rather than a convenience: the
code every other backend suite depends on has to be reachable without the
containers it exists to start.

Nothing is mocked. `node:fs` is real, the environment is real, and a descriptor
in a test is a plain object satisfying the published contract, because that is
what a descriptor is in production too.

What the suite therefore does **not** cover is a container actually starting: the
image pull, the wait strategy being satisfied, `provides(host, port)` over a
mapped port, the startup-log tail on a failure. Those need a runtime, and the
evidence for them is the same evidence it has always been — every backend suite
in the repo goes through `startOne`, so a break there fails everywhere at once
rather than quietly. Duplicating that here would buy a slower copy of a signal we
already get.

## Considered and rejected

- **Keep the module state and reset it between tests.** An exported `reset()` is
  a second way to be wrong about which containers are current, and it makes
  every test order-dependent on the last. The singleton is the defect; a hook to
  work around it is not a fix.
- **Inject a container-starting seam so a test can supply a fake.** It would let
  a test assert a container start without a runtime, by asserting against a
  double of the one thing this package owns outright. The result is a test of the
  test double, and a public seam whose only consumer is the suite.
- **Put the reaper toggle in the handle's `env` instead of `process.env`.**
  Testcontainers reads it off `process.env` when it first builds its config, so
  the write has to happen there. The handle's `env` is what test workers receive,
  and adding a key no worker needs would change what every suite hydrates.
- **Have the handle expose its started containers.** Nothing needs them, and the
  list is mutated by `stop()`, so exposing it would hand out a reference whose
  contents change underneath the holder.
