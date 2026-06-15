import { logger } from '@acme/logger';

/**
 * Walk the `.cause` chain to the deepest error. Drizzle / postgres-js wrap the
 * real `PostgresError` (carrying its `code`, e.g. `42P01` undefined_table) one
 * or two levels below the `TRPCError`, so logging only the top-level message
 * shows `Failed query: ...` twice and hides the actual failure.
 */
export function rootCause(error: unknown) {
  let current: unknown = error;
  while (current instanceof Error && current.cause != null) {
    current = current.cause;
  }
  return current;
}

interface OnErrorOpts {
  error: Error;
  path?: string;
}

/**
 * Structured `onError` logger for the tRPC fetch handler. Logs the unwrapped
 * root cause (and its Postgres `code` when present) alongside the path, so the
 * underlying driver error is visible instead of the wrapper's generic message.
 */
export function logTRPCError({ error, path }: OnErrorOpts) {
  const cause = rootCause(error);
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const pgCode =
    cause instanceof Error && 'code' in cause ? cause.code : undefined;

  logger.error(
    { path: path ?? '<no-path>', err: error, causeMessage, pgCode },
    `❌ tRPC failed on ${path ?? '<no-path>'}`,
  );
}
