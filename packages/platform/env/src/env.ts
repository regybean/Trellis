/**
 * `shouldSkipEnvValidation()` — the single source of truth for when a package's
 * `createEnv` skips schema validation. Replaces the predicate that used to be
 * copy-pasted into every package's `env.ts`.
 *
 * `createEnv({ skipValidation: true })` passes raw `process.env` through
 * untyped and *uncoerced* — so `z.coerce.number()` never runs and a numeric var
 * arrives as its string. That is correct for steps that have no real env and
 * never touch a coerced value (lint, the Next production build), but wrong for
 * tests, which must validate + coerce against real values (ADR 0014).
 *
 * `CI` alone can't separate the two: it is set both for the lint/build CI steps
 * *and* for the testcontainer test run. `VITEST` (set by vitest in every worker)
 * is the discriminator.
 *
 * Precedence:
 *   1. lint / a production build — skip unconditionally (no real env, none needed).
 *   2. under vitest — always validate + coerce (ADR 0014), even in CI.
 *   3. otherwise — skip when CI (a non-test CI step, or a bare worktree with no
 *      `.env`), validate locally.
 *
 * Build detection uses `IS_NEXT_BUILD` (set by the next apps' build scripts),
 * not `NEXT_PHASE`: `next.config.js` jiti-imports `env` before Next sets
 * `NEXT_PHASE`, so the phase check never fired at build time and a bare
 * worktree build blew up on missing runtime env. `NEXT_PHASE` is kept as a
 * secondary signal for the non-build Next phases. (Vite/TanStack builds don't
 * import env at config load, so they need no build flag.)
 */
export function shouldSkipEnvValidation() {
  if (process.env.npm_lifecycle_event === 'lint') return true;
  if (process.env.IS_NEXT_BUILD) return true;
  if (process.env.NEXT_PHASE === 'phase-production-build') return true;
  if (process.env.VITEST) return false;
  return !!process.env.CI;
}
