import type { AnyRouter } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import type { BaseContext } from './index';
import { logTRPCError } from './error';

/**
 * Framework-parametric tRPC route substrate. The fetch-adapter wiring, the
 * standard `logTRPCError` `onError` hook, and CORS/OPTIONS are the same for
 * every app — only the *context resolver* differs (a resolved session for the
 * full apps, a constant local principal for the slim apps). That resolver stays
 * app-owned
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

/**
 * A feature's router, seen through the only thing this module needs from it:
 * the context its procedures read.
 *
 * Parameterised on the *context* rather than on the router, because
 * `inferRouterContext<TRouter extends AnyRouter>` is `any` — `AnyRouter` is
 * `Router<any, any>`, so a resolver typed against it would be checked against
 * nothing. Naming `$types.ctx` as the parameter recovers the feature's own
 * concrete context at every call site.
 */
type RouterWithContext<TContext extends BaseContext> = AnyRouter & {
  _def: { _config: { $types: { ctx: TContext } } };
};

/**
 * Exported because each app's route seam wraps this handler in its framework's
 * shape and forwards these options verbatim — re-declaring them per app is how
 * the two drifted apart before (see the module comment).
 */
export interface TRPCFetchHandlerOptions<TContext extends BaseContext> {
  /** The tRPC endpoint path, e.g. `/api/trpc/chat`. */
  endpoint: string;
  /** The feature's aggregated app router. */
  router: RouterWithContext<TContext>;
  /**
   * App-owned context resolver: build the request context (resolve a session,
   * inject a constant principal, hand over an entitlements provider). This is
   * the only per-app/per-framework piece — the auth seam stays in the app.
   *
   * Its return type is pinned to the *router's own* context, so a mount whose
   * feature reads a field the app's resolver doesn't produce fails to compile.
   * That check used to be spelled out by threading the feature's
   * `createTRPCContext` alongside; the router already carried the type, and the
   * identity function that carried it is gone (#264). `NoInfer` keeps the
   * router the sole inference site, so a resolver missing a field is a mismatch
   * rather than a wider `TContext`.
   */
  resolver: (req: Request) => NoInfer<TContext> | Promise<NoInfer<TContext>>;
}

/**
 * Build the fetch handler for a feature's tRPC mount. The same handler serves
 * both GET and POST (the latter for mutations, the former also carrying
 * `httpSubscriptionLink` SSE streams such as `chat.stream`). `logTRPCError` is
 * baked in so structured error logging can't be forgotten.
 */
export function createTRPCFetchHandler<TContext extends BaseContext>({
  endpoint,
  router,
  resolver,
}: TRPCFetchHandlerOptions<TContext>) {
  return (req: Request) =>
    fetchRequestHandler({
      endpoint,
      req,
      router,
      createContext: () => resolver(req),
      onError: logTRPCError,
    });
}
