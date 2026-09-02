import { z } from 'zod/v4';

/**
 * The Better Auth half of the provider→principal mapping, alongside the Clerk
 * half in `./session.ts` until #226 deletes it.
 *
 * It lives here rather than in each app for the same reason the Clerk mapping
 * does: *resolving* the session is framework-specific and app-owned (Next.js
 * middleware vs. a TanStack Start server function), but turning the resolved
 * session into `@acme/trpc`'s neutral principal is **provider**-specific, and
 * both full apps need the identical answer. In particular `primaryEmailAddress`
 * has to match `@acme/billing`'s augmentation of `InjectedUser` exactly — two
 * declarations of one merged member must agree — so it is built once, here.
 *
 * Both functions are typed **structurally**, on the fields they actually read,
 * rather than against `Session`. That is deliberate and not laziness: Better
 * Auth types `getSession` as returning the core user columns only, so its result
 * is not assignable to `Session` (whose `UserWithRole` intersection requires the
 * admin plugin's fields). Naming the read fields instead means an app can hand
 * these the value it has, and a renamed Better Auth field is a compile error at
 * the one call site that resolves the session.
 */

/**
 * The role, validated rather than asserted — the same discipline `readRole`
 * applies to Clerk's claims, for the opposite reason.
 *
 * Better Auth's admin plugin stores the role as free text on the user row
 * (`authUser.role` is a nullable `text`) and, as above, omits it from
 * `getSession`'s return type altogether. So the role is a runtime fact with no
 * static promise behind it, which is exactly the situation a parse is for: an
 * absent, null or unrecognised value reads as *no role* rather than propagating
 * something `@acme/trpc`'s closed `Roles` union cannot mean.
 *
 * The substantive difference from Clerk: the role is a **column**, not a JWT
 * claim (ADR 0034). Nothing here decodes a token.
 */
const withRole = z.object({ role: z.enum(['admin', 'user']) });

/** The caller's role, or `null` when signed out, role-less or unrecognised. */
export function readSessionRole(user: unknown) {
  const parsed = withRole.safeParse(user);
  return parsed.success ? parsed.data.role : null;
}

/** What `toPrincipal` reads off a resolved session. See the module docblock. */
interface ResolvedSession {
  user: {
    id: string;
    email: string;
  };
}

/**
 * Map a resolved Better Auth session onto the platform's neutral
 * `InjectedUser`, or `null` when there is no session.
 *
 * Supersedes `toInjectedPrincipal` (the Clerk mapping), and is simpler than it
 * in a way worth naming: Clerk needed a second round trip to fetch the `User`
 * because identity lived in the session token and the profile lived in the API,
 * so the mapping took two arguments and had to stay useful when the user fetch
 * came back empty. Better Auth resolves `{ session, user }` from one database
 * read, so the row the session points at is always there.
 */
export function toPrincipal(
  session: ResolvedSession | null,
): InjectedUser | null {
  if (!session) return null;

  const { id, email } = session.user;

  return {
    id,
    role: readSessionRole(session.user) ?? undefined,
    // Better Auth's core schema has exactly one email per user (it is `user`'s
    // unique key), so there is no primary to pick out of a list the way Clerk's
    // `emailAddresses` array required — and therefore never a signed-in caller
    // with no address for billing's Stripe customer lookup to open against.
    primaryEmailAddress: { emailAddress: email },
  };
}
