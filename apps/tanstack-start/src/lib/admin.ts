import type { UserWithRole } from 'better-auth/plugins/admin';
import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { z } from 'zod';

import type { UserManagementUser } from '@acme/ui';
import { readSessionRole } from '@acme/auth/server';

import { auth } from '~/lib/auth-server';

/**
 * App-owned admin data + role mutations as TanStack Start server functions —
 * the framework-specific counterpart to the Next.js app's RSC data-load +
 * `'use server'` actions. The neutral presentational `UserManagement` component
 * (in `@acme/ui`) is shared by both apps; only this server glue is per-app.
 *
 * **Authorization is the admin plugin's, not ours.** Every endpoint below is
 * gated by Better Auth's own admin middleware, which resolves the session from
 * the passed headers and rejects a non-admin caller. The hand-rolled
 * `assertAdmin()` this file used to open with is gone: under Clerk the role was a
 * JWT claim only we knew how to read, so the check had to be ours; under Better
 * Auth the role is a column the plugin owns and checks (ADR 0034). The route's
 * `beforeLoad` still redirects non-admins, but that is a redirect, not the gate —
 * calling these server functions directly is refused here.
 */

/**
 * Better Auth's user row, shaped for `@acme/ui`'s admin widgets.
 *
 * ⚠️ **This adapter is temporary and #225 deletes it.** `UserManagementUser` is
 * still Clerk's user shape — an `emailAddresses` array with a
 * `primaryEmailAddressId` pointing into it, `publicMetadata.role`,
 * `lastSignInAt` — because `apps/nextjs` renders the same widget and is still on
 * Clerk until #223 lands. #225 cuts the widget back to what Better Auth actually
 * stores, and this function collapses to a pass-through when it does.
 *
 * Two fields have no honest source and are marked as such rather than invented:
 * Better Auth stores one email per user (it is `user`'s unique key), so the
 * "array plus a pointer at the primary" is a single row wearing Clerk's shape;
 * and the core schema tracks no last-sign-in, so it is `null` rather than a
 * guess derived from the newest `session` row.
 */
function toManagementUser(user: UserWithRole): UserManagementUser {
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

export const listUsers = createServerFn({ method: 'GET' })
  .validator(z.object({ search: z.string().optional() }))
  .handler(async ({ data }) => {
    // `searchField`/`searchOperator` are required alongside a `searchValue` —
    // the plugin has no default, so an omitted operator searches nothing. Email
    // substring matching is what the Clerk `query` parameter did.
    const { users } = await auth.api.listUsers({
      query: data.search
        ? {
            searchValue: data.search,
            searchField: 'email',
            searchOperator: 'contains',
          }
        : {},
      headers: getRequestHeaders(),
    });

    return users.map((user) => toManagementUser(user));
  });

export const setUserRole = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), role: z.enum(['admin', 'user']) }))
  .handler(async ({ data }) => {
    await auth.api.setRole({
      body: { userId: data.id, role: data.role },
      headers: getRequestHeaders(),
    });
  });

/**
 * Demote to `user`. There is no "no role" state to return to: Clerk's version
 * wrote `publicMetadata.role = null`, but Better Auth's admin plugin defaults a
 * new user's column to `'user'`, so plain membership *is* a role and clearing it
 * would put the row in a state nothing else in the system produces.
 */
export const removeUserRole = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await auth.api.setRole({
      body: { userId: data.id, role: 'user' },
      headers: getRequestHeaders(),
    });
  });
