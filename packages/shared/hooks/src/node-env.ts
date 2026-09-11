/**
 * The `NODE_ENV` union the feature-client factory switches on, plus the
 * resolver that produces it from a raw environment read.
 *
 * Both are exported, and they serve different callers. A feature that owns an
 * env module has already narrowed `NODE_ENV` with its own
 * `z.enum(['development','production','test'])` — it wants {@link NodeEnv} to
 * name the type it is passing. A feature that owns no env module (it holds no
 * secret and authors no config) has nothing to narrow with, and would otherwise
 * re-derive this helper per feature — it wants {@link resolveNodeEnv}.
 *
 * This module carries no `'use client'` and no `process.env` read: the union is
 * shared by both halves of a feature, and the raw value arrives from the
 * caller's own sanctioned env edge, so `@acme/hooks` stays env-agnostic.
 */

/**
 * The three `NODE_ENV` values every feature's env validates to. Kept as a
 * literal union rather than bare `string` so the MSW test seam (`'test'`) and
 * the dev `loggerLink` (`'development'`) switch on a closed set the compiler
 * checks.
 */
export type NodeEnv = 'development' | 'production' | 'test';

const NODE_ENVS: readonly NodeEnv[] = ['development', 'production', 'test'];

/**
 * Narrow a possibly-absent raw `NODE_ENV` to {@link NodeEnv} — the shape the
 * raw environment actually has.
 *
 * Absent or unrecognised resolves to `'production'`, the one value that
 * switches on no development-only or test-only behaviour. A missing variable
 * therefore cannot hand a deployed process the dev logger link or the MSW seam;
 * the worst it can do is withhold them locally, which is visible immediately.
 */
export function resolveNodeEnv(raw: string | undefined) {
  return NODE_ENVS.find((candidate) => candidate === raw) ?? 'production';
}
