'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '~/server/auth';

/**
 * The one role mutation the admin surface needs, as a Next.js server action.
 *
 * The caller's own admin-ness is **not** checked here: `auth.api.setRole` is
 * itself an admin-gated endpoint, so it resolves the caller's session from the
 * forwarded headers and rejects a non-admin. Re-checking first would be a
 * second, weaker copy of the same rule.
 *
 * There is no separate `removeRole`. Better Auth has no "clear the role" call —
 * `role` is a column with a `defaultRole` of `user`, not a nullable metadata bag
 * — so demoting *is* setting `user`, and the two actions were one call under two
 * names (#225).
 *
 * The input is parsed rather than trusted: a server action is a public HTTP
 * endpoint, so `role` arrives as unvalidated client input even though the only
 * caller in the app sends the union.
 */
const setRoleInput = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'user']),
});

export async function setRole(input: z.infer<typeof setRoleInput>) {
  const { userId, role } = setRoleInput.parse(input);

  await auth.api.setRole({
    body: { userId, role },
    headers: await headers(),
  });

  // The dashboard is an RSC that reads the user list on the server, so the new
  // role only reaches the page if this render is discarded.
  revalidatePath('/admin');
}
