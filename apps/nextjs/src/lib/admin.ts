'use server';

import { headers } from 'next/headers';

import { auth } from '~/server/auth';

// `formData.get` is `string | File | null`; the role form only ever submits
// text fields, so narrow to a string rather than blind-stringifying a File.
const getField = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

/**
 * Set a user's role through Better Auth's admin plugin (#223).
 *
 * The caller's own admin-ness is **not** checked here: `auth.api.setRole` is
 * itself an admin-gated endpoint, so it resolves the caller's session from the
 * forwarded headers and rejects a non-admin. Re-checking first would be a second,
 * weaker copy of the same rule — the previous Clerk implementation needed one
 * because `clerkClient()` is unauthenticated backend access with no such gate.
 *
 * Role management as a *feature* — the admin widget rework — is a separate
 * ticket; this is the minimum that keeps the existing dashboard working with no
 * Clerk dependency.
 */
export async function setRole(formData: FormData) {
  await auth.api.setRole({
    body: {
      userId: getField(formData, 'id'),
      role: getField(formData, 'role') === 'admin' ? 'admin' : 'user',
    },
    headers: await headers(),
  });
}

/**
 * Demote a user to the default role.
 *
 * Better Auth has no "clear the role" call — `role` is a column with a
 * `defaultRole` of `user`, not Clerk's nullable metadata bag — so removing admin
 * *is* setting `user`. Behaviour is unchanged: both end states are a non-admin.
 */
export async function removeRole(formData: FormData) {
  await auth.api.setRole({
    body: { userId: getField(formData, 'id'), role: 'user' },
    headers: await headers(),
  });
}
