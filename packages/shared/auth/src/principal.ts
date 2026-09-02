import { z } from 'zod/v4';

import type { UserManagementUser } from '@acme/ui';

/**
 * Everything that turns a resolved Better Auth session into a shape the rest of
 * the repo understands: the role read, the tRPC principal, and the row the admin
 * widget renders.
 *
 * These live here rather than in each app because of where the framework line
 * actually falls. *Resolving* a session is framework-specific and app-owned
 * (Next.js middleware vs. a TanStack Start server function); turning what came
 * back into a neutral shape is **provider**-specific, and both full apps need
 * the identical answer (ADR 0003's amendment). #237 and #238 each wrote their
 * own copy of all three; #239 collapsed them to these.
 *
 * In particular `primaryEmailAddress` has to match `@acme/billing`'s
 * augmentation of `InjectedUser` exactly — two declarations of one merged member
 * must agree — so it is built once, here.
 *
 * The functions are typed **structurally**, on the fields they actually read,
 * rather than against `Session`. That is deliberate and not laziness: Better
 * Auth types `getSession` as returning the core user columns only, so its result
 * is not assignable to `Session` (whose `UserWithRole` intersection requires the
 * admin plugin's fields). Naming the read fields instead means an app can hand
 * these the value it has, and a renamed Better Auth field is a compile error at
 * the one call site that resolves the session.
 */

/**
 * The role, validated rather than asserted.
 *
 * Better Auth's admin plugin stores the role as free text on the user row
 * (`authUser.role` is a nullable `text`) and omits it from `getSession`'s return
 * type altogether. So the role is a runtime fact with no static promise behind
 * it, which is exactly the situation a parse is for: an absent, null or
 * unrecognised value reads as *no role* rather than propagating something
 * `@acme/trpc`'s closed `Roles` union cannot mean.
 *
 * The role is a **column**, not a JWT claim (ADR 0034). Nothing here decodes a
 * token.
 */
const withRole = z.object({ role: z.enum(['admin', 'user']) });

/**
 * The user row this reads a role off. `role` is optional because Better Auth
 * omits the admin plugin's columns from `getSession`'s static type; `id` is
 * required because a type whose every property is optional is a *weak type*,
 * which TypeScript checks by "shares at least one property" — and a resolved
 * `{ session, user }` shares none, so the mistake below would go on compiling.
 */
interface RoleBearingUser {
  id: string;
  role?: unknown;
}

/**
 * The caller's role, or `null` when signed out, role-less or unrecognised.
 *
 * The parameter is a user *row*, not `unknown`. That is the whole guarantee the
 * module docblock claims: `unknown` accepts anything, so `readSessionRole(session)`
 * — passing the resolved `{ session, user }` instead of `session.user` — used to
 * type-check, fail the `safeParse` silently and degrade every caller to
 * non-admin, with no compile error and no runtime error. Now it is a type error.
 */
export function readSessionRole(user: RoleBearingUser) {
  const parsed = withRole.safeParse(user);
  return parsed.success ? parsed.data.role : null;
}

/** What `toPrincipal` reads off a resolved session. See the module docblock. */
interface ResolvedSession {
  user: RoleBearingUser & { email: string };
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

/** What `toManagementUser` reads off an admin-plugin user row. */
interface ManageableUser extends RoleBearingUser {
  email: string;
  image?: string | null;
  createdAt: Date;
}

/**
 * A Better Auth user row, shaped for `@acme/ui`'s admin widgets.
 *
 * ⚠️ **This adapter is a translation layer, and #225 deletes it.**
 * `UserManagementUser` is still Clerk's user shape — an `emailAddresses` array
 * with a `primaryEmailAddressId` pointing into it, `publicMetadata.role`,
 * `lastSignInAt` — because that is what the widget was written against
 * (ADR 0013). #225 cuts the widget back to what Better Auth actually stores, and
 * this function goes with it.
 *
 * Two fields have no honest source and are marked as such rather than invented:
 * Better Auth stores one email per user (it is `user`'s unique key), so the
 * "array plus a pointer at the primary" is a single row wearing Clerk's shape;
 * and the core schema tracks no last-sign-in, so it is `null` rather than a
 * guess derived from the newest `session` row.
 */
export function toManagementUser(user: ManageableUser): UserManagementUser {
  return {
    id: user.id,
    imageUrl: user.image ?? '',
    primaryEmailAddressId: user.id,
    emailAddresses: [{ id: user.id, emailAddress: user.email }],
    publicMetadata: { role: readSessionRole(user) ?? undefined },
    createdAt: user.createdAt.getTime(),
    lastSignInAt: null,
  };
}
