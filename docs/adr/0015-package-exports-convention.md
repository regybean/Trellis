# Package `exports` follow a bounded, concern-driven convention

Every runtime package's `exports` map (`packages/platform|shared|features`,
plus `compositions` if reintroduced) obeys one shared shape, enforced by
`scripts/check-exports.mjs` (wired into `pnpm lint`, hard-fail):

- **JIT source/compiled-types hybrid.** Each entry is
  `{ "types": "./dist/<name>.d.ts", "default": "./src/<name>.ts" }`. Apps
  transpile raw feature `src` TS (Next `transpilePackages` / Vite); typecheckers
  read the prebuilt `tsc` `.d.ts`. `default` never points at `dist`; `types`
  never points at `src`.
- **Bounded vocabulary.** Subpath keys are drawn from a fixed set: the roles
  `.`, `./server`, `./schema`, `./env`, `./testing`, plus explicitly-registered
  one-off seams (`./handler`, `./register`, `./server-next`,
  `./ownership-trpc`). No freeform subpaths — widening the set is a deliberate
  edit to the checker.
- **Concern-driven presence.** A role is exported when the package genuinely has
  that concern, not when a consumer currently imports it (`@acme/feedback/env`
  stays though nothing imports it yet) and not by fabricating empty modules. An
  accidental leak of an internal helper is removed (`@acme/trpc`'s `./error` is
  now an internal `./error` import inside `handler.ts`).
- **File naming.** A barrel (≥2 re-exports) for a role is named
  `index-<role>.ts` (`index-server.ts`, `index-schema.ts`); a single-concern
  module keeps its own name (`env.ts`, `handler.ts`, `register.ts`).
- **`sideEffects` declared everywhere.** Pure/leaf packages set
  `"sideEffects": false` to unlock tree-shaking of large barrels (notably
  `@acme/ui`). Packages holding a bare `import 'server-only'` guard or a
  side-effecting entry set the array form listing exactly those files, so the
  guard/preload is never elided.

## Considered Options

- **Freeform exports** (the drift we had): auth used `server.ts` where every
  other `./server` used `index-server.ts`; `@acme/trpc` exported an
  internal-only `./error`; no `sideEffects` anywhere, so a blanket
  `sideEffects: false` later would silently strip `import 'server-only'`
  guards. Cheap per-change, but the surface diverged package-by-package with no
  tripwire.
- **Minimal surface** (export only what a consumer imports today): smallest
  API, but couples a package's shape to current wiring — adding the first
  consumer of an existing concern becomes a package.json edit, and the map stops
  describing the package's concerns.
- **Bounded vocabulary + concern-driven presence** (chosen): structure over
  minimal surface. The map reads as a fixed role vocabulary; presence signals a
  concern; a lint check keeps every package honest and makes new roles a
  conscious act.

## Consequences

- New packages must conform: allowed keys ∈ the vocabulary, entries match the
  dist/src shape. A genuinely new role/seam is added to `ALLOWED_KEYS` in
  `scripts/check-exports.mjs` with a comment — that edit *is* the design review.
- `sideEffects` arrays must track guarded files. Moving/renaming a
  `server-only`-guarded module means updating the array, or the guard can be
  tree-shaken away in a client bundle (fails loud at build, but the failure is
  indirect).
- `@acme/rag` gained an `import 'server-only'` guard on `index-server.ts`
  (previously unguarded) and a `server-only` dependency, closing a gap where
  server-only RAG code could be pulled into a client bundle.
- The check is not a substitute for `knip`/`syncpack`; it polices *shape and
  vocabulary*, not whether an export is reachable.
- Scope is the runtime layers (`packages/platform`, `packages/shared`,
  `packages/features`, `packages/compositions`). Apps ship no `exports`;
  `tooling/*` config packages (`@acme/eslint-config`, `@acme/test-utils`, …)
  are deliberately excluded — they surface freeform config subpaths consumed as
  config, not the JIT dist/src runtime hybrid.
