import type { AnyRouter } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { logTRPCError } from './error';

/**
 * Framework-parametric tRPC route substrate. The fetch-adapter wiring, the
 * standard `logTRPCError` `onError` hook, and CORS/OPTIONS are the same for
 * every app — only the *context resolver* differs (Clerk for the full apps, a
 * constant local principal for the slim apps). That resolver stays app-owned
 * (ADR 0003 / ADR 0010); this module owns everything that isn't auth, so the
 * handler shape and error logging can't drift per-app (they did: one app
 * hand-rolled `console.error` and missed structured logging; another omitted
 * the OPTIONS handler entirely).
 *
 * Each app feeds its resolver to `createTRPCFetchHandler` and composes the
 * result into its framework's handler shape (Next.js exports `GET`/`POST`
 * directly; TanStack Start wraps `({ request }) => handler(request)`).
 */

/**
 * The CORS preflight headers — the single source of the cross-app CORS policy
 * (extend to match your needs). The trivial 204 `Response` is built in each
 * app's own `OPTIONS` handler, because the `Response` global is provided by the
 * framework runtime (Next vs TanStack/Nitro) and constructing it here would
 * cross a Node-vs-DOM `Response` type boundary. The policy that actually drifts
 * lives here once; the one-line construction stays at the framework seam.
 */
export const corsPreflightHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Request-Method': '*',
  'Access-Control-Allow-Methods': 'OPTIONS, GET, POST',
  'Access-Control-Allow-Headers': '*',
};

interface TRPCFetchHandlerOptions<TRouter extends AnyRouter, TContextInput> {
  /** The tRPC endpoint path, e.g. `/api/trpc/chat`. */
  endpoint: string;
  /** The feature's aggregated app router. */
  router: TRouter;
  /** The feature's `createTRPCContext` (re-exported from the platform seam). */
  createContext: (input: TContextInput) => Promise<unknown>;
  /**
   * App-owned context resolver: shape the neutral context input from the
   * request (resolve Clerk, or inject a constant principal). This is the only
   * per-app/per-framework piece — the auth seam stays in the app.
   */
  resolver: (req: Request) => TContextInput | Promise<TContextInput>;
}

/**
 * Build the fetch handler for a feature's tRPC mount. The same handler serves
 * both GET and POST (the latter for mutations, the former also carrying
 * `httpSubscriptionLink` SSE streams such as `chat.stream`). `logTRPCError` is
 * baked in so structured error logging can't be forgotten.
 */
export function createTRPCFetchHandler<
  TRouter extends AnyRouter,
  TContextInput,
>({
  endpoint,
  router,
  createContext,
  resolver,
}: TRPCFetchHandlerOptions<TRouter, TContextInput>) {
  return (req: Request) =>
    fetchRequestHandler({
      endpoint,
      req,
      router,
      createContext: async () => createContext(await resolver(req)),
      onError: logTRPCError,
    });
}
