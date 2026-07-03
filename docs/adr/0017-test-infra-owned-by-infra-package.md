# A suite declares its test infra explicitly; the descriptor is owned by the infra package

A backend suite starts exactly the containers it names in `backendProject({ infra:
[…] })`. The descriptors are **pure data** exported by the package that owns the
infra (`@acme/redis/testing`, `@acme/db/testing`), and `@acme/test-utils` is a
generic engine that turns a descriptor into a running container. The non-obvious
part is that test infra is **declared per-suite, not derived from the dependency
graph** — the deliberate opposite of dev infra ([ADR 0009](0009-graph-derived-dev-infra.md)).

## Why not graph-derive it, like dev does

ADR 0009 derives an app's dev infra from the union of `acme.infra` over its
transitive closure — correct there, because a *running* app really touches
everything its closure couples to. A *test suite* does not: it mocks stateful
dependencies. `@acme/ingest` depends on `@acme/rag` (→ `postgres`) and `@acme/redis`
(→ `redis`), so the closure says `{postgres, redis, localstack}` — yet the ingest
suite mocks `@acme/rag/server` and S3 and needs **no** container at all.

A suite's real-infra need is a function of its **mock boundary**, which lives in
`setup.ts`, not in the dependency graph. So the graph over-includes for tests, and
the env-prune rules of ADR 0009 are wrong here too (`staticTestEnv` sets
`LLM_PROVIDER=ollama`, so the dev pruner would *keep* ollama, which tests always
mock). Rather than invent a second derivation that guesses the mock boundary, the
suite states its infra outright. The test-real vocabulary is tiny — in practice
`postgres` and `redis` — so an explicit list is both clearer and honest.

## Descriptor is data, owned by the infra package

`@acme/redis/testing` and `@acme/db/testing` export plain-data descriptors — image,
port, the env keys the container populates, any init bind — and nothing else. The
feature's `vitest.config.backend.ts` (which sits above `platform` and may import
these) composes them: `backendProject({ infra: [pgContainer, redisContainer] })`.

- **Keeps `@testcontainers/*` out of `platform`.** The descriptor is data, so
  `@acme/redis`/`@acme/db` gain no test-runner dependency; only `@acme/test-utils`
  builds the container from the data.
- **`@acme/test-utils` owns only the mechanism.** `staticTestEnv`, env hydration,
  the `backendProject` preset, and the data→container/hydrate engine. It no longer
  encodes *which package needs what* (that's the suite) or *how each infra is built*
  (that's the owner). This is what the package's own CONTEXT calls being
  "infra-only", finished.
- **This resolves the layer boundary.** `@acme/test-utils` is `tooling` and cannot
  import `platform`; composing descriptors at the feature config (not inside
  test-utils) is what lets ownership move down to the infra package without an
  upward import.

## Status

accepted

## Implementation note

`backendProject({ infra })` JSON-encodes the (pure-data) descriptors into the
suite's test env under `ACME_TEST_INFRA`; the shared global-setup reads them from
the resolved project config (`project.config.env`) — the config-eval module realm
does not share singletons with, nor propagate `process.env` to, the global-setup
main process, so the descriptors travel as serialised data rather than a shared
registry. Being pure data (no functions) is what makes that possible.

## Considered and rejected

- **Reuse `resolve-infra.mjs` with a test reducer** (closure ∩ containers).
  Rejected — the ingest counterexample shows the closure over-includes whenever a
  suite mocks a stateful dep; the graph can't see the mock boundary.
- **Derive from which real clients the closure imports.** Rejected — brittle: a dep
  can be imported without needing its container (billing constructs a `_db` it never
  queries, yet genuinely needs Postgres only to satisfy env validation).
- **Keep a central string-keyed registry in `@acme/test-utils`.** Rejected as the
  end state — it keeps the "how to build each infra" in tooling; owning the
  descriptor as data beside the client keeps the image pinned next to what it serves.
