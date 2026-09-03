import { z } from 'zod/v4';

import type { InjectedUser } from '@acme/trpc';
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
 * The role is a **column**, not a JWT claim (ADR 0001). Nothing here decodes a
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
 * One argument, and no absent-user case to handle: Better Auth resolves
 * `{ session, user }` from a single database read, so the row the session points
 * at is always there.
 */
export function toPrincipal(
  session: ResolvedSession | null,
): InjectedUser | null {
  if (!session) return null;

  const { id, email } = session.user;

  // Better Auth's core schema has exactly one email per user (it is `user`'s
  // unique key), so there is no primary to pick out of a list — and therefore
  // never a signed-in caller with no address for billing's Stripe customer
  // lookup to open against.
  return { id, role: readSessionRole(session.user) ?? undefined, email };
}

/** What `toAdminUser` reads off an admin-plugin user row. */
interface ManageableUser extends RoleBearingUser {
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
}

/**
 * A Better Auth user row, as `@acme/ui`'s admin widgets consume it.
 *
 * Not a translation layer. #225 cut the widget back to exactly what Better Auth
 * stores, so nothing here has to fabricate a field to satisfy a shape the
 * provider has no source for (ADR 0001). That leaves this doing one honest job.
 *
 * That job is the `role` column, and it is why the function still exists rather
 * than the apps spreading the row straight into the widget. The column is
 * nullable free text that Better Auth omits from its static types; the widget
 * renders a closed `'user' | 'admin'` union. `readSessionRole` is the parse
 * between the two, and it belongs here — one copy, next to the `Roles` union it
 * answers to — not duplicated in each app.
 *
 * `image` widens to `string | null` because the widget distinguishes "no avatar"
 * from an empty string, and `undefined` is not a state a database column has.
 */
export function toAdminUser(user: ManageableUser): UserManagementUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image ?? null,
    createdAt: user.createdAt,
    role: readSessionRole(user) ?? undefined,
  };
}
