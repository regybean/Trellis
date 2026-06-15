import { auth, clerkClient } from '@clerk/tanstack-react-start/server';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { transformUserForClient } from '@acme/auth/server';

/**
 * App-owned admin data + role mutations as TanStack Start server functions —
 * the framework-specific replacement for the Next.js admin composition's RSC
 * data-load + `'use server'` actions. The neutral presentational `UserManagement`
 * component (from `@acme/admin`) is reused unchanged; only this server glue is
 * per-app. See docs/adr/0003-framework-agnostic-auth-seam.md.
 */
async function assertAdmin() {
  const { sessionClaims } = await auth();
  if (sessionClaims?.metadata.role !== 'admin') {
    throw new Error('Not authorized');
  }
}

export const listUsers = createServerFn({ method: 'GET' })
  .validator(z.object({ search: z.string().optional() }))
  .handler(async ({ data }) => {
    await assertAdmin();
    const client = clerkClient();
    const { data: users } = data.search
      ? await client.users.getUserList({ query: data.search })
      : await client.users.getUserList();
    return users.map((user) => transformUserForClient(user));
  });

export const setUserRole = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), role: z.enum(['admin', 'user']) }))
  .handler(async ({ data }) => {
    await assertAdmin();
    const client = clerkClient();
    await client.users.updateUserMetadata(data.id, {
      publicMetadata: { role: data.role },
    });
  });

export const removeUserRole = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await assertAdmin();
    const client = clerkClient();
    await client.users.updateUserMetadata(data.id, {
      publicMetadata: { role: null },
    });
  });
