import 'server-only';

import { z } from 'zod/v4';

/**
 * The Better Auth → neutral-principal mapping for this app (#223).
 *
 * Auth resolution is app-owned (ADR 0003), and since #218 the two full apps are
 * on different providers, so the mapping lives here rather than in `@acme/auth`
 * — the shared package holds the provider *instance*, not either app's opinion
 * about how a session becomes a principal. `apps/tanstack-start` keeps using
 * `@acme/auth/server`'s Clerk-shaped equivalents until its own migration.
 *
 * The platform and the features only ever see `ctx.session.user`.
 */

/**
 * The fields this app reads off a resolved session's user, validated rather than
 * asserted — for the same reason the Clerk mapping parsed its session claims.
 *
 * `role` is the specific reason. It is contributed by the **admin plugin**, and
 * Better Auth does not thread plugin-added user fields into the static return
 * type of `auth.api.getSession`: the column is there and the value comes back,
 * but the type says otherwise. Parsing is how that gap is crossed without an
 * `as`, and it is a real check — the plugin stores `role` as free text (it
 * supports comma-separated multi-role), so an unrecognised value reads as no
 * role and fails closed at `adminProcedure`.
 */
const principalSchema = z.object({
  id: z.string().nonempty(),
  email: z.string().nonempty(),
  role: z.enum(['admin', 'user']).nullish(),
});

/** A resolved session, as `auth.api.getSession` returns it (or `null`). */
type ResolvedSession = { user: unknown } | null;

/**
 * A role column value narrowed to a role this app recognises, or `null`. Shared
 * by the session read below and the admin user list, so both fail closed on an
 * unexpected value in exactly the same way.
 */
export function parseRole(value: unknown) {
  const role = principalSchema.shape.role.safeParse(value);
  return role.success ? (role.data ?? null) : null;
}

/** The caller's role, or `null` when signed out or role-less. */
export function readRole(session: ResolvedSession) {
  const user = principalSchema.safeParse(session?.user);
  return user.success ? (user.data.role ?? null) : null;
}

/**
 * Map a resolved Better Auth session onto the platform's neutral `InjectedUser`.
 *
 * `primaryEmailAddress` is the one field beyond the base seam that this app
 * injects (declared in `@acme/auth`'s `types/globals.d.ts`, which the app's
 * tsconfig includes): `@acme/billing` opens a Stripe customer with it. Better
 * Auth keeps a single `email` on the user row, so the structural shape the seam
 * declares is built from it here — the one place a provider field is read.
 */
export function toInjectedPrincipal(session: ResolvedSession) {
  const user = principalSchema.safeParse(session?.user);

  if (!user.success) return null;

  return {
    id: user.data.id,
    role: user.data.role ?? undefined,
    primaryEmailAddress: { emailAddress: user.data.email },
  };
}
