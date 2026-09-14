/**
 * A type probe for `initAuth`'s plugin seam: compiled, never run.
 *
 * Half of what the seam promises is a type. The plugins a caller passes stay
 * individually visible in the returned instance, so reaching one of their
 * endpoints is a compile-time fact rather than a runtime discovery. Nothing
 * about that is observable at runtime, so the suite beside this file cannot
 * guard it — a refactor that widened the tuple back to `BetterAuthPlugin[]`
 * would erase the endpoints from the type and still pass every test.
 *
 * It sits under `src/` rather than in a checker because the guarantee needs
 * *declaration emit*, not a type check. `pnpm typecheck` runs `tsc --noEmit`,
 * and TS2742 — the inferred type cannot be named without a reference — is an
 * error tsc raises only when it has to write a `.d.ts`. That is the error the
 * one explicit return type in `../../init-auth.ts` exists to avoid, and the
 * one a future refactor is most likely to reintroduce. This package's tsconfig
 * emits declarations for everything under `src`, tests included, so `build`
 * compiles this file and the quality gate covers both halves: the assertions
 * below, and the emit that has to carry them.
 *
 * Vitest never collects it — the backend project only picks up `*.test.ts`.
 *
 * See [ADR 0004](../../../docs/adr/0004-initauth-takes-a-plugin-list.md).
 */
import { oneTimeToken } from 'better-auth/plugins/one-time-token';

import { initAuth } from '../../init-auth';

/** Never dialled: no instance here is built, only typed. */
const BASE_URL = 'https://type-probe.invalid';

/**
 * The two instances under probe, with and without a caller's plugin.
 *
 * Both return un-annotated on purpose. That is what makes tsc infer the whole
 * instance type and write it into the emitted declaration, which is where a
 * TS2742 regression surfaces. Neither function is ever called.
 */
export function probeDefaultInstance() {
  return initAuth({ baseUrl: BASE_URL });
}

export function probePluginInstance() {
  return initAuth({ baseUrl: BASE_URL, plugins: [oneTimeToken()] });
}

/** Compiles only when `T` is `true`; anything else is the failure. */
type Assert<T extends true> = T;

/** `true` when `TKey` is a property of `T`. */
type Has<T, TKey extends PropertyKey> = TKey extends keyof T ? true : false;

/** The inverse, named so the negative case below reads as one assertion. */
type Lacks<T, TKey extends PropertyKey> =
  Has<T, TKey> extends true ? false : true;

type DefaultApi = ReturnType<typeof probeDefaultInstance>['api'];
type DefaultSession = ReturnType<
  typeof probeDefaultInstance
>['$Infer']['Session'];
type PluginApi = ReturnType<typeof probePluginInstance>['api'];

/**
 * The guarantees, one tuple element each — an element that stops being `true`
 * fails the build on its own line.
 *
 * Exported so declaration emit has to resolve every type they reach through.
 */
export type PluginSeamGuarantees = [
  // Passing no plugins leaves today's instance where it was: the credential
  // provider's sign-up, the unconditional admin plugin's user listing, and the
  // inferred `{ session, user }`.
  Assert<Has<DefaultApi, 'signUpEmail'>>,
  Assert<Has<DefaultApi, 'listUsers'>>,
  Assert<Has<DefaultSession, 'session'>>,
  Assert<Has<DefaultSession, 'user'>>,
  // An appended plugin's own endpoint reaches the caller.
  Assert<Has<PluginApi, 'generateOneTimeToken'>>,
  // And reaches only the caller who asked for it. This negative is what
  // separates precise per-instance types from merely permissive ones: a seam
  // that surfaced every plugin's endpoints on every instance would satisfy the
  // positive above and still be wrong.
  Assert<Lacks<DefaultApi, 'generateOneTimeToken'>>,
];
