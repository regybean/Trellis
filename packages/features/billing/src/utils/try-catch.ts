/**
 * A simple try-catch wrapper that returns an error object instead of throwing.
 *
 * Kept local to billing rather than promoted to a shared package: it's a
 * two-line generic with no billing coupling, and its only consumers are the
 * app-level Stripe webhook routes (via `@acme/billing/server`). Promoting it
 * would add a cross-package dependency for no gain.
 */
export async function tryCatch<T>(
  fn: () => Promise<T>,
): Promise<{ data?: T; error?: Error }> {
  try {
    const data = await fn();
    return { data };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}
