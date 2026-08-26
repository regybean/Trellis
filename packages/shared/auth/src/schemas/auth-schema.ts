import { pgSchema, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Better Auth's four core tables, hand-authored as Drizzle tables.
 *
 * **Why a dedicated `auth` schema, not the per-app one.** Every other app-owned
 * table lives under `pgSchema(NEXT_PUBLIC_WEBAPP)` so the four apps sharing one
 * Postgres can't see each other's rows (ADR 0008). Identity is the deliberate
 * exception: a person signing in to `nextjs` and to `tanstack-start` is the same
 * person, and a per-app identity store would mean four rows, four password
 * hashes and four sessions for one human. The schema name is therefore a
 * constant, not derived from `NEXT_PUBLIC_WEBAPP`. See ADR 0034.
 *
 * **Why hand-authored.** `@better-auth/cli generate` can emit `pgSchema()` (its
 * drizzle adapter takes a `schemaName`), but wiring a codegen step for four
 * small tables buys nothing this file doesn't already give — and the generated
 * output would still need editing to match repo conventions (timestamptz, the
 * `auth*` export names below). The backend suite is what proves the adapter
 * resolves these cross-schema tables at runtime.
 *
 * **The contract with Better Auth is the property names, not the columns.** The
 * Drizzle adapter looks tables up as `schema[model][field]` where `field` is
 * Better Auth's field name — camelCase by default (`emailVerified`, `userId`).
 * So the *property* keys below are fixed by Better Auth; the SQL column names
 * are ours (snake_case, matching what the CLI would emit). Renaming a property
 * key breaks auth at runtime, not at compile time.
 */
export const authSchema = pgSchema('auth');

/**
 * `role`, `banned`, `banReason` and `banExpires` come from the admin plugin, not
 * Better Auth core. They are not optional extras: the plugin's session-create
 * hook reads `banned`/`banExpires` on every sign-in, so a missing column breaks
 * sign-in rather than just the ban feature.
 */
export const authUser = authSchema.table('user', (t) => ({
  id: t.text('id').primaryKey(),
  name: t.text('name').notNull(),
  email: t.text('email').notNull().unique(),
  emailVerified: t.boolean('email_verified').notNull().default(false),
  image: t.text('image'),
  // timestamptz throughout (the repo convention, and what `@acme/feedback`
  // already uses) rather than the CLI's naive `timestamp`: Better Auth compares
  // `expiresAt` against `Date.now()` in JS, and a naive column makes that
  // comparison depend on the server's local offset.
  createdAt: t
    .timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: t
    .timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  role: t.text('role'),
  banned: t.boolean('banned').default(false),
  banReason: t.text('ban_reason'),
  banExpires: t.timestamp('ban_expires', { withTimezone: true }),
}));

/**
 * Sessions are rows, not stateless cookies — the substantive behavioural change
 * from Clerk. `token` is the opaque value the session cookie carries; deleting
 * the row revokes the session on the next request. `impersonatedBy` is the admin
 * plugin's.
 */
export const authSession = authSchema.table('session', (t) => ({
  id: t.text('id').primaryKey(),
  expiresAt: t.timestamp('expires_at', { withTimezone: true }).notNull(),
  token: t.text('token').notNull().unique(),
  createdAt: t
    .timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: t
    .timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  ipAddress: t.text('ip_address'),
  userAgent: t.text('user_agent'),
  userId: t
    .text('user_id')
    .notNull()
    .references(() => authUser.id, { onDelete: 'cascade' }),
  impersonatedBy: t.text('impersonated_by'),
}));

/**
 * One row per credential or social account linked to a user. Email/password
 * sign-up writes a single row with `providerId: 'credential'` and the scrypt
 * hash in `password`; the OAuth columns stay null until a social provider is
 * added.
 */
export const authAccount = authSchema.table(
  'account',
  (t) => ({
    id: t.text('id').primaryKey(),
    issuer: t.text('issuer').notNull(),
    accountId: t.text('account_id').notNull(),
    providerId: t.text('provider_id').notNull(),
    userId: t
      .text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: t.text('access_token'),
    refreshToken: t.text('refresh_token'),
    idToken: t.text('id_token'),
    accessTokenExpiresAt: t.timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: t.timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: t.text('scope'),
    password: t.text('password'),
    createdAt: t
      .timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: t
      .timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [
    // Better Auth declares this unique index itself (core `account` table); it is
    // reproduced here because push manages the DDL, not Better Auth's migrator.
    uniqueIndex('account_issuer_account_id_unique').on(t.issuer, t.accountId),
  ],
);

/** Short-lived tokens: email verification, password reset. */
export const authVerification = authSchema.table('verification', (t) => ({
  id: t.text('id').primaryKey(),
  identifier: t.text('identifier').notNull(),
  value: t.text('value').notNull(),
  expiresAt: t.timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: t
    .timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: t
    .timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}));

/**
 * The adapter's model→table map. The *keys* are Better Auth's model names and
 * are part of its contract; the values are the exports above, prefixed so
 * `user`/`session`/`account` don't collide in a consumer's import scope.
 */
export const authTables = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
};
