import type { UserWithRole } from 'better-auth/plugins/admin';
import type { Auth as BetterAuthInstance } from 'better-auth/types';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
// `better-auth/minimal` rather than `better-auth`: the default entry bundles
// Kysely so that `database` can take a raw connection. We always pass an
// adapter, so that is dead weight in every app bundle.
import { betterAuth } from 'better-auth/minimal';
import { admin } from 'better-auth/plugins/admin';

import { createDb } from '@acme/db';

import { betterAuthEnv } from './env';
import { authTables } from './schemas/auth-schema';

export interface InitAuthOptions {
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
}

/**
 * The Better Auth configuration, split out from `initAuth` only so its inferred
 * type can be named: `betterAuth()` returns `Auth<typeof theOptionsYouPassed>`,
 * and `Auth` lives at a path outside Better Auth's `exports` map, so TypeScript
 * refuses to emit a declaration for an un-annotated `initAuth` (TS2742) — hence
 * the one explicit return type below.
 */
function authOptions(options: InitAuthOptions) {
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
      // Email + password only, no social provider. #218 left the question open;
      // a provider is purely additive (an `account` row with the OAuth columns
      // populated — the schema already carries them) and needs client-id secrets
      // per app, so it is deliberately not part of this change.
      enabled: true,
    },
    session: {
      // Sessions are database rows, and every request resolves them by reading
      // one. Better Auth defaults this off; it is set explicitly because it is a
      // load-bearing decision, not a tuning knob — with the cookie cache on, a
      // deleted or revoked session row would keep resolving until the cached
      // cookie expired. See ADR 0034.
      cookieCache: { enabled: false },
    },
    plugins: [
      // Adds `role`/`banned`/`banReason`/`banExpires` to `user` and
      // `impersonatedBy` to `session` (all declared in ./schemas/auth-schema),
      // plus the admin API the user-management widgets need. Roles live on the
      // user row, not in a token claim.
      admin(),
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
 */
export function initAuth(
  options: InitAuthOptions,
): BetterAuthInstance<ReturnType<typeof authOptions>> {
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
