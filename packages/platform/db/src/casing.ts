/**
 * The one column-naming convention for this repo: snake_case.
 *
 * Two different tools derive SQL identifiers from the same Drizzle schema —
 * drizzle-kit writes the DDL (`db:push` / `db:generate`) and drizzle-orm writes
 * the queries (`createDb()`). If they disagree, push creates `email_verified`
 * while a query asks for `emailVerified` and Postgres answers `column ... does
 * not exist` at runtime, with nothing failing at build time. That is why this is
 * a shared constant rather than the same literal typed into five files: every
 * app's `drizzle.config.ts` imports it, and so does `createDb()`, so the two
 * halves cannot drift apart.
 *
 * Every table in this repo names its columns explicitly
 * (`t.boolean('email_verified')`), and an explicit name always beats this
 * setting, so today it changes no DDL. It governs the column that forgets to.
 * The Mastra mirrors in `@acme/rag` keep camelCase identifiers on purpose —
 * Mastra owns that DDL and we only mirror it — and they are explicit, so they
 * are unaffected.
 */
export const DRIZZLE_CASING = 'snake_case';
