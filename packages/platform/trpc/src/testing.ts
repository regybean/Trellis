/**
 * tRPC test helpers — the ONE canonical source for a backend test context.
 *
 * Shipped as the `@acme/trpc/testing` export subpath so every feature builds its
 * tRPC caller context from the same place, typed against the REAL platform
 * contract (`InjectedSession`, `InjectedUser`) rather than the structural
 * `as any` casts a tooling package was forced into. Prod code never imports this
 * subpath (it is tree-shaken out); only `*.test.ts` and backend `setup.ts` files
 * do.
 *
 * Fidelity: `createTestContext` returns exactly the shape `createTRPCContext`
 * produces, and takes the same context extension as a type parameter. A feature
 * with a billing extension hands it `entitlements: createMockEntitlements(...)`
 * from `@acme/entitlements/testing` — the tier and credit knobs live with the
 * mock provider that resolves *to* them, not here, so a feature with no tiers
 * (`feedback`, `ingest`) names none (#256).
 */
import type {
  ContextOpts,
  InjectedSession,
  InjectedUser,
  Roles,
} from './index';

/**
 * What `createTestContext` needs beyond the feature's extension: the session, in
 * exactly the shape the platform consumes it. The principal arrives whole rather
 * than as `userId` + `role`, so a feature whose procedures read a field beyond
 * identity (billing reads `email`) sets it here instead of this package
 * inventing one.
 *
 * Nested under `session` rather than passed as a bare `user`, so that every key
 * a test hands in is a key the real context has. That is what lets the extension
 * merge straight through below without the builder having to pick the principal
 * back out of it.
 */
export type TestContextOptions = Pick<ContextOpts, 'session'>;

/**
 * The knobs a *feature's* own `createTestContext` wrapper exposes to its tests:
 * identity and role. The wrapper turns `userId`/`role` into the feature's own
 * `InjectedUser`, and adds whatever its context extension needs — see any
 * feature's `tests/backend/utils/test-context.ts`.
 */
export interface FeatureTestContextOptions {
  userId: string;
  role: Roles;
}

/**
 * A stubbed session in the neutral `InjectedSession` shape the platform
 * actually consumes (an auth provider is resolved in the app adapter, never
 * here) — just enough for `protectedProcedure` to narrow the principal and
 * `adminProcedure` to read its role.
 */
export function createMockSession(user: InjectedUser) {
  return { user } satisfies InjectedSession;
}

/**
 * Build a tRPC caller context for backend tests. Pass it straight to a feature's
 * `appRouter.createCaller(...)`. Stubs the session and merges in the feature's
 * context extension; real DB/Redis come from the feature's own `db`/`redis`
 * clients (validated against the running containers — never mocked). Telemetry
 * is ambient (ADR 0023) — there is no span in a caller test, so the ambient
 * helpers noop, and nothing needs stubbing here.
 *
 * `TExtension` mirrors `createTRPCContext`'s: the extension's fields arrive
 * alongside `session` and are passed through untouched, so a test builds its
 * context exactly the way an app adapter builds a real one.
 *
 * The return type is spelled out rather than inferred, which is the one place
 * this file departs from the repo's usual "let it infer". An inferred `headers`
 * resolves `Headers` against whichever lib the *consuming* package compiles
 * with, and they don't all agree — `@acme/auth` reads a `Headers` whose
 * iterators differ from `@acme/trpc`'s, and the context stops matching
 * `createCaller`. Naming `ContextOpts` pins every base field to the declaration
 * the router was built from.
 */
export function createTestContext<TExtension extends object = object>(
  opts: TestContextOptions & TExtension,
): ContextOpts & TExtension {
  return {
    headers: new Headers(),
    // A realistic app origin so procedures that build absolute redirect URLs
    // (billing checkout) resolve one, matching what an app edge would inject.
    origin: 'http://localhost:3000',
    ...opts,
  };
}
