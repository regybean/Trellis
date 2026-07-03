# A suite declares its test infra explicitly; the descriptor is owned by the infra package

A backend suite starts exactly the containers it names in a tiny per-suite
global-setup file: `export default runInfraSetup([postgresContainer,
redisContainer])`. The descriptors are **live objects** exported by the package
that owns the infra (`@acme/redis/testing`, `@acme/db/testing`); the suite
imports them directly and `@acme/test-utils` is a generic engine that turns a
descriptor into a running container. The non-obvious part is that test infra is
**declared per-suite, not derived from the dependency graph** — the deliberate
opposite of dev infra ([ADR 0009](0009-graph-derived-dev-infra.md)).

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

## Descriptor owned by the infra package

`@acme/redis/testing` and `@acme/db/testing` export descriptors — image, port,
container env, any init bind, and a `provides(host, port)` function projecting the
running container into the `process.env` keys that infra validates. The suite
composes them in a per-suite global-setup file (which sits above `platform` and
may import these): `export default runInfraSetup([postgresContainer,
redisContainer])`, wired via
`backendProject({ globalSetup: './src/tests/backend/global-setup.ts' })`.

- **Keeps `@testcontainers/*` out of `platform`.** The descriptor is a plain
  object, so `@acme/redis`/`@acme/db` gain no test-runner dependency; only
  `@acme/test-utils` builds the container from it.
- **`@acme/test-utils` owns only the mechanism.** `staticTestEnv`, env hydration,
  the `backendProject` preset, and the `runInfraSetup` engine. It no longer
  encodes *which package needs what* (that's the suite's global-setup) or *how each
  infra is built* (that's the owner's descriptor). This is what the package's own
  CONTEXT calls being "infra-only", finished.
- **This resolves the layer boundary.** `@acme/test-utils` is `tooling` and cannot
  import `platform`; importing the descriptors in the suite's own global-setup
  (not inside test-utils) is what lets ownership move down to the infra package
  without an upward import.
- **One record crosses to workers.** `runInfraSetup` merges every descriptor's
  `provides(...)` and publishes it as a single `infraEnv` record via
  `project.provide`; `hydrate-env` copies it into `process.env`. No per-key list
  to maintain.

## Status

accepted

## LocalStack folds into the same model

The `aws` secrets-backend test (in `@acme/test-utils`) needs LocalStack and
nothing else. It is expressed as a `localstackContainer` descriptor and run
through the same `runInfraSetup([localstackContainer])` — no bespoke start/stop
helpers. The descriptor lives beside that test (its sole consumer) rather than in
an owner package, since the backend under test is the repo's root `scripts/`, not
a package.

## Considered and rejected

- **Reuse `resolve-infra.mjs` with a test reducer** (closure ∩ containers).
  Rejected — the ingest counterexample shows the closure over-includes whenever a
  suite mocks a stateful dep; the graph can't see the mock boundary.
- **Derive from which real clients the closure imports.** Rejected — brittle: a dep
  can be imported without needing its container (billing constructs a `_db` it never
  queries, yet genuinely needs Postgres only to satisfy env validation).
- **Keep a central string-keyed registry in `@acme/test-utils`.** Rejected as the
  end state — it keeps the "how to build each infra" in tooling; owning the
  descriptor beside the client keeps the image pinned next to what it serves.
- **Serialise descriptors through the test env to keep one shared global-setup.**
  Rejected — the descriptors would have to be pure JSON (forcing a `{host}`/`{port}`
  template DSL instead of a `provides` function) and travel through an
  `ACME_TEST_INFRA` env channel read back from `project.config.env`. A ~5-line
  per-suite global-setup file that imports the descriptors as live objects is
  simpler, needs no serialisation or DSL, and unifies with the LocalStack path.
