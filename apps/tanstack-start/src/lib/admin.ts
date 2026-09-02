import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { z } from 'zod';

import { toAdminUser } from '@acme/auth/server';

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

    return users.map((user) => toAdminUser(user));
  });

/**
 * Assign a role. One server function covers promotion and demotion: there is no
 * "no role" state to return to — Clerk's version wrote
 * `publicMetadata.role = null`, but Better Auth's admin plugin defaults a new
 * user's column to `'user'`, so plain membership *is* a role and clearing it
 * would put the row in a state nothing else in the system produces. The
 * separate `removeUserRole` this file used to export was the same call under a
 * second name (#225).
 */
export const setUserRole = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string(), role: z.enum(['admin', 'user']) }))
  .handler(async ({ data }) => {
    await auth.api.setRole({
      body: { userId: data.userId, role: data.role },
      headers: getRequestHeaders(),
    });
  });
