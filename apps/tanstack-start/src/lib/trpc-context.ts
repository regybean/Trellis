import { toPrincipal } from '@acme/auth/server';

import { auth } from '~/lib/auth-server';
import { entitlements } from '~/server/deps';

/**
 * App-owned auth seam: resolve the Better Auth session on the server and map it
 * onto the platform's neutral `InjectedSession`. This is the neutral
 * `BaseContext` every mount receives; a mount whose feature context is exactly
 * that (`feedback`, `ingest`, `notifications`) names this resolver — the
 * feature packages never import an auth SDK themselves.
 *
 * The session comes from the request's own `Headers`, not from an ambient request
 * context: `auth.api.getSession` needs only the `Cookie` header, and the tRPC
 * fetch handler already holds the `Request`. So there is no request middleware
 * for auth at all, and this resolver behaves identically wherever it is called
 * from.
 *
 * Resolving the session is the framework-specific half; the provider-specific
 * mapping onto the neutral principal is `@acme/auth`'s `toPrincipal`, shared with
 * the Next.js app. Every request costs one database read of `session` — auth is
 * stateful now, and a revoked row stops resolving immediately (@acme/auth ADR 0001).
 */
export async function resolveAuthContext(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });

  return {
    headers: req.headers,
    req,
    // The app's own public origin (its PORT in dev, deploy origin in prod), read
    // off the request so billing can build the absolute Stripe checkout redirect
    // URLs from the authored paths (@acme/env ADR 0001).
    origin: new URL(req.url).origin,
    session: { user: toPrincipal(session) },
  };
}

/**
 * The base context plus the entitlements provider — the extra field `@acme/chat`
 * and `@acme/billing` name on their own contexts (#256, ADR 0006). Chosen per
 * mount rather than injected into every context, so the mounts that meter
 * credits or gate tiers get a provider and the mounts that do neither
 * (`feedback`, `ingest`, `notifications`) are handed nothing they cannot name.
 *
 * The provider comes from `~/server/deps`, this app's composition root — the
 * same value `worker.ts` refunds through, because there is only one (ADR 0006).
 */
export async function resolveAuthContextWithEntitlements(req: Request) {
  return { ...(await resolveAuthContext(req)), entitlements };
}
