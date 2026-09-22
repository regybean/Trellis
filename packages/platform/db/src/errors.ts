/**
 * Recognising a Postgres constraint violation, once, in the package that owns
 * the driver. A domain module needs this to turn a unique index into a named
 * domain failure rather than letting `Failed query: insert into ...` reach a
 * user-facing toast, and none of them should be re-deriving how postgres-js
 * nests its error.
 */

/**
 * Walk the `.cause` chain to the deepest error: drizzle wraps the real
 * `PostgresError` — the one carrying `code` — one or two levels down.
 *
 * Module-private, and knowingly the twin of `@acme/trpc`'s exported
 * `rootCause`. Sharing it would mean `@acme/trpc` depending on `@acme/db`,
 * which would drag the database into the transport substrate of every app
 * including the ones that have no tables — a worse trade than six duplicated
 * lines.
 */
function rootCause(error: unknown) {
  let current: unknown = error;
  while (current instanceof Error && current.cause != null) {
    current = current.cause;
  }
  return current;
}

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * Did this error come from a unique index, and optionally from THAT one?
 *
 * Pass the constraint name wherever the statement touches a table with more
 * than one unique index: without it, a collision on an unrelated index is
 * reported as the one the caller happened to be expecting.
 */
export function isUniqueViolation(error: unknown, constraint?: string) {
  const cause = rootCause(error);
  if (!(cause instanceof Error) || !('code' in cause)) return false;
  if (cause.code !== UNIQUE_VIOLATION) return false;
  if (constraint === undefined) return true;
  return 'constraint_name' in cause && cause.constraint_name === constraint;
}
