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
 * decoded token claims, or `null` when signed out. Claims are `unknown`-valued
 * by construction, which is why the role is parsed rather than read.
 */
interface ResolvedSession {
  sessionClaims: Record<string, unknown> | null;
}

/** The caller's role, or `null` when signed out or role-less. */
export function readRole(session: ResolvedSession) {
  const metadata = roleMetadata.safeParse(session.sessionClaims?.metadata);
  return metadata.success ? (metadata.data.role ?? null) : null;
}
