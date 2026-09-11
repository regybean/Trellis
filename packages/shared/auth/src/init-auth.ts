import type { UserWithRole } from 'better-auth/plugins/admin';
import type {
  Auth as BetterAuthInstance,
  BetterAuthPlugin,
} from 'better-auth/types';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
// `better-auth/minimal` rather than `better-auth`: the default entry bundles
// Kysely so that `database` can take a raw connection. We always pass an
// adapter, so that is dead weight in every app bundle.
import { betterAuth } from 'better-auth/minimal';
import { admin } from 'better-auth/plugins/admin';

import { createDb } from '@acme/db';

import { betterAuthEnv } from './env';
import { authTables } from './schemas/auth-schema';

export interface InitAuthOptions<
  TPlugins extends readonly BetterAuthPlugin[] = readonly [],
> {
  /**
   * Origin the auth routes are mounted on — `http://localhost:3000` in dev, the
   * deployed origin in production. App-owned: each app runs on its own port, so
   * this cannot be a slice-level constant. Better Auth builds callback URLs and
   * checks request origins against it.
   */
  baseUrl: string;
  /**
   * Additional origins allowed to submit auth requests (a separate frontend
   * host, a preview domain). `baseUrl` is always trusted.
   */
  trustedOrigins?: string[];
  /**
   * Better Auth plugins to *append* to the built-ins — an identity provider's
   * plugin being the case this exists for. The built-ins are not replaceable:
   * `admin()` always runs, because the shared schema already declares its
   * columns.
   *
   * Omitting this is the default and forces no import from a Better Auth
   * plugin path on the caller. What a plugin passed here contributes stays
   * visible in the returned instance's type, so calling one of its endpoints is
   * a compile-time fact rather than a runtime discovery.
   */
  plugins?: TPlugins;
  /**
   * Whether the credential (email + password) provider is registered. Defaults
   * to on, which is what both full apps mount.
   *
   * `false` registers no password routes — for a consumer whose users sign in
   * through a provider and which ships no password form. It sets Better Auth's
   * `enabled` flag rather than dropping the key, so the options object keeps its
   * shape and the inferred instance and session types do not move.
   */
  emailAndPassword?: boolean;
}

/**
 * The Better Auth configuration, split out from `initAuth` only so its inferred
 * type can be named: `betterAuth()` returns `Auth<typeof theOptionsYouPassed>`,
 * and `Auth` lives at a path outside Better Auth's `exports` map, so TypeScript
 * refuses to emit a declaration for an un-annotated `initAuth` (TS2742) — hence
 * the one explicit return type below.
 *
 * Generic over the caller's plugin tuple, and the tuple is spread into the array
 * literal rather than concatenated: that is what keeps the plugins individually
 * visible instead of widening them to `BetterAuthPlugin[]`, which would erase
 * whatever endpoints they contribute from the returned instance's type.
 */
function authOptions<
  const TPlugins extends readonly BetterAuthPlugin[] = readonly [],
>(options: InitAuthOptions<TPlugins>) {
  const env = betterAuthEnv();

  return {
    database: drizzleAdapter(createDb(), {
      provider: 'pg',
      // Passed explicitly because the tables live in the `auth` Postgres schema
      // rather than being discovered from a bound drizzle schema — `createDb()`
      // binds none (each slice owns its tables).
      schema: authTables,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: options.baseUrl,
    trustedOrigins: options.trustedOrigins,
    emailAndPassword: {
      // On unless the caller says otherwise: both full apps mount the password
      // form. A consumer whose users arrive through a provider turns it off and
      // ships no password endpoints. The key stays present either way — see
      // `InitAuthOptions.emailAndPassword`.
      enabled: options.emailAndPassword ?? true,
    },
    session: {
      // Sessions are database rows, and every request resolves them by reading
      // one. Better Auth defaults this off; it is set explicitly because it is
      // a load-bearing decision, not a tuning knob — with the cookie cache on,
      // a deleted or revoked session row would keep resolving until the cached
      // cookie expired. See
      // [ADR 0001](../docs/adr/0001-self-hosted-better-auth.md).
      cookieCache: { enabled: false },
    },
    plugins: [
      // Adds `role`/`banned`/`banReason`/`banExpires` to `user` and
      // `impersonatedBy` to `session` (all declared in ./schemas/auth-schema),
      // plus the admin API the user-management widgets need. Roles live on the
      // user row, not in a token claim. Unconditional: those columns are in the
      // shared schema, so an instance without it would be running against a
      // schema describing a plugin it does not have.
      admin(),
      ...(options.plugins ?? []),
    ],
  };
}

/**
 * Build the app's Better Auth instance.
 *
 * A factory rather than a module-level singleton (the create-t3-turbo pattern):
 * the per-app values in `InitAuthOptions` are only known at the app's own
 * composition edge, and a shared-layer package must not read them. Each app
 * calls this once.
 *
 * The secret is *not* a parameter. It is a slice-owned secret declared and
 * validated by `./env`, which is exactly what the `./env` export role is for —
 * threading it through the app would give the app a value it has no decision to
 * make about (contrast `baseUrl`, which is genuinely per-app).
 *
 * Two of the decisions are the caller's: `plugins` appends to the built-ins and
 * `emailAndPassword` turns the credential provider off. Both are optional, so a
 * caller that passes neither gets exactly today's instance — which is why the
 * plugin tuple's type parameter carries an empty-tuple default rather than being
 * required.
 */
export function initAuth<
  const TPlugins extends readonly BetterAuthPlugin[] = readonly [],
>(
  options: InitAuthOptions<TPlugins>,
): BetterAuthInstance<ReturnType<typeof authOptions<TPlugins>>> {
  return betterAuth(authOptions(options));
}

/** The app's fully-inferred Better Auth instance. */
export type Auth = ReturnType<typeof initAuth>;

/**
 * `{ session, user }` as Better Auth resolves it, with the admin plugin's user
 * fields.
 *
 * The intersection is doing real work: Better Auth's `$Infer` does *not* widen
 * `user` with a plugin's schema fields, and it types `getSession` as returning
 * the core columns only — the admin plugin surfaces `role`/`banned`/… as its own
 * `UserWithRole` on the admin endpoints instead. The row genuinely carries them
 * (see `authUser`, and the role assertions in the backend suite), so the type is
 * corrected here once rather than at every consumer.
 */
export type Session = Omit<Auth['$Infer']['Session'], 'user'> & {
  user: UserWithRole;
};
