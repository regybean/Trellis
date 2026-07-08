# Env-validation skip is one policy in `@acme/env`, not a predicate copied per package

Every package's `env.ts` calls `createEnv({ ..., skipValidation })`. `skipValidation: true`
passes raw `process.env` through **untyped and uncoerced** — `z.coerce.number()` never
runs — which is right for steps that have no real env and touch no coerced value, and
wrong for tests, which must validate + coerce against real values ([ADR 0014](0014-tests-validate-real-env.md)).

The predicate was copy-pasted into ~14 `env.ts` files:

```ts
const skipValidation =
  !!process.env.CI ||
  process.env.npm_lifecycle_event === "lint" ||
  process.env.NEXT_PHASE === "phase-production-build";
```

Two things were wrong with it, both masked by the Turbo cache until worktrees began
exercising the uncached paths ([ADR 0019](0019-worktrees-mirror-ci-test-infra.md)):

1. **`CI` is overloaded.** It is set for the lint/build CI steps _and_ for the
   testcontainer test run. The predicate skipped on any `CI`, so backend tests under
   CI validated **nothing** — `EMBED_DIMENSIONS` reached `pgVector.createIndex()` as the
   string `'768'` (never coerced), the index build rejected it, and `mastra_documents`
   was never created. ADR 0014's "tests validate real env" was quietly violated in CI.
2. **`NEXT_PHASE` is the wrong build signal.** `next.config.js` jiti-imports `env`
   _before_ Next sets `NEXT_PHASE`, so the phase check never fired at build time. A bare
   worktree `next build` therefore tried to validate (and, past that, construct
   `new PgVector({ host })`) with no `.env`, and blew up. The build scripts already
   export `IS_NEXT_BUILD=true` (declared in `turbo.json` `globalEnv`) — that is the
   signal set early enough to be seen.

## Decision

A new zero-dependency platform leaf, **`@acme/env`**, exports one function that every
`env.ts` calls. The 14 duplicated predicates are deleted.

```ts
export function shouldSkipEnvValidation() {
  if (process.env.npm_lifecycle_event === "lint") return true; // no env, none needed
  if (process.env.IS_NEXT_BUILD) return true; // next build (set early)
  if (process.env.NEXT_PHASE === "phase-production-build") return true; // non-build Next phases
  if (process.env.VITEST) return false; // tests always validate (ADR 0014)
  return !!process.env.CI; // non-test CI / bare worktree
}
```

The single behavioural change from the old predicate is the **`VITEST` carve-out**:
vitest sets `VITEST` in every worker, so a test run validates + coerces even under `CI`,
while lint / build / non-test CI still skip. This is what fixes the `EMBED_DIMENSIONS`
class of bug. `IS_NEXT_BUILD` before `NEXT_PHASE` is what fixes the bare-worktree build.

`@acme/env` is a platform package (tag `platform`), so any layer may depend on it. Its one
source file is `src/env.ts`, matched by the `restrictEnvAccess` `**/env.ts` ignore, so its
direct `process.env` reads are legitimate — reading `process.env` to decide the skip _is_
the package's job.

## Worktree `.env` inheritance

Skipping validation at build no longer aborts a bare-worktree build, but route modules
still construct clients eagerly at import (`new PgVector({ host: DB_HOST })` in `@acme/rag`),
which throws on an empty host — builds legitimately need runtime env. Rather than lazy-init
every such client, a linked worktree **inherits the primary checkout's env by symlink**:
`scripts/link-worktree-env.mjs` (in the `postinstall` chain) detects a linked worktree
(`git rev-parse --git-dir` ≠ `--git-common-dir`) and symlinks the primary's `.env` +
`apps/*/.env` in. It no-ops on the primary checkout and in real CI (no linked worktree),
and never clobbers a real file. This extends [ADR 0019](0019-worktrees-mirror-ci-test-infra.md)
(worktrees mirror CI for tests) to build/run env.

## Considered and rejected

- **Keep the per-package predicate, just add `VITEST`/`IS_NEXT_BUILD`.** Fixes the bug in
  14 places and drifts again the next time one is edited. Centralising is the point.
- **Lazy-init `PgVector` (and every other import-time client) so builds need no env.**
  Larger, riskier blast radius across `@acme/rag` internals; env at build is not actually
  wrong to require. Symlinking the primary's `.env` is cheaper and honest.
- **Copy `.env` into the worktree.** Duplicates secrets on disk and goes stale; a symlink
  tracks the source.

## Status

accepted

## Consequences

- Turning validation on under `VITEST` means every required var in every `env.ts` must
  exist in `staticTestEnv` (`tooling/test-utils`); a missing one now fails loudly instead
  of being skipped. Auditing that set is a follow-up.
- A new env-skip condition is a one-line edit in `@acme/env`, applied everywhere at once.
- Adding `@acme/env` as a dependency of a package that reads env is now mandatory boilerplate,
  the same way `@t3-oss/env-nextjs` is.
