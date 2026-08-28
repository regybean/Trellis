import type { User } from '@clerk/backend';
import { z } from 'zod/v4';

/**
 * The role claim, validated rather than asserted. Clerk types session claims as
 * `{ [k: string]: unknown }`, so the shape has to be checked at the boundary —
 * and this is the one place in the repo that knows a role rides in the session
 * token's `metadata`. Apps read the role through here (route guards, the admin
 * gate, and the tRPC context resolvers); the platform and the features only ever
 * see the neutral `role` on `ctx.session.user`.
 */
const roleMetadata = z.object({ role: z.enum(['admin', 'user']).optional() });

/**
 * A resolved session, as `auth()` returns it on either Clerk framework SDK: the
 * signed-in user's id (or `null`), plus the decoded token claims, which are
 * `unknown`-valued by construction — which is why the role is parsed, not read.
 */
interface ResolvedSession {
  userId: string | null;
  sessionClaims: Record<string, unknown> | null;
}

/** The caller's role, or `null` when signed out or role-less. */
export function readRole(session: Pick<ResolvedSession, 'sessionClaims'>) {
  const metadata = roleMetadata.safeParse(session.sessionClaims?.metadata);
  return metadata.success ? (metadata.data.role ?? null) : null;
}

/**
 * Map a resolved Clerk session (+ the optionally fetched `User`) onto the
 * platform's neutral `InjectedUser`. This is the one Clerk→principal mapping in
 * the repo: both full apps resolve their own SDK's `auth()` and user fetch —
 * that part is framework-specific — then hand the results here, because the
 * *mapping* is provider-specific and belongs with the rest of the Clerk-shaped
 * pieces. See docs/adr/0003-framework-agnostic-auth-seam.md.
 *
 * Identity comes off the **session**, not the user fetch, deliberately: that is
 * what `protectedProcedure` has always gated on, so a signed-in caller whose
 * `User` fetch comes back empty still authenticates (it just has no email, and
 * only billing's Stripe customer lookup cares).
 *
 * `primaryEmailAddress` is typed structurally on the seam but read off the real
 * Clerk `User` here, so a renamed provider field is a compile error in exactly
 * one place.
 */
export function toInjectedPrincipal(
  session: ResolvedSession,
  user: User | null,
): InjectedUser | null {
  if (!session.userId) return null;

  return {
    id: session.userId,
    role: readRole(session) ?? undefined,
    primaryEmailAddress: user?.primaryEmailAddress ?? null,
  };
}
