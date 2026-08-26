/**
 * Fixtures for the Better Auth suite.
 *
 * Everything here goes through the real thing: a real Postgres, the real Drizzle
 * adapter, real scrypt hashing. Nothing is mocked — the point of this suite is
 * that the hand-authored cross-schema tables resolve at runtime, which a mock
 * would hide.
 */
import { like } from 'drizzle-orm';

import { createDb } from '@acme/db';

import { initAuth } from '../../../init-auth';
import { authUser, authVerification } from '../../../schemas/auth-schema';

/**
 * Every user this suite creates gets an address on this domain, and cleanup
 * deletes by it. The `auth` schema is *shared*, not per-suite like the
 * `NEXT_PUBLIC_WEBAPP` schemas (ADR 0034) — on the local compose path that is a
 * developer's actual identity table, so a blanket `DELETE FROM auth.user` would
 * wipe real rows. `session` and `account` cascade from `user`.
 */
export const TEST_EMAIL_DOMAIN = 'auth-suite.invalid';

/** The instance under test. `baseUrl` is arbitrary — no request ever leaves. */
export const auth = initAuth({ baseUrl: 'http://localhost:3000' });

/** A second handle on the same database, for asserting on rows directly. */
export const db = createDb();

let counter = 0;

/** A unique address per call, so tests don't collide on `user.email`'s unique. */
export function testEmail(label: string) {
  counter += 1;
  return `${label}-${counter}@${TEST_EMAIL_DOMAIN}`;
}

/** Over Better Auth's 8-character minimum. */
const PASSWORD = 'correct-horse-battery';

export async function signUp(email: string) {
  const { user } = await auth.api.signUpEmail({
    body: { name: `Test ${email}`, email, password: PASSWORD },
  });
  return user;
}

/**
 * Sign in and return the `Cookie` header a subsequent request would carry.
 * `getSession` reads the session token from it, exactly as a browser request
 * would — which is what makes this suite exercise the real cookie→row lookup
 * rather than an internal helper.
 */
export async function signInAndGetHeaders(email: string) {
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  const cookies = headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
  return new Headers({ cookie: cookies });
}

/** Delete only this suite's rows. See `TEST_EMAIL_DOMAIN`. */
export async function cleanupTestData() {
  await db
    .delete(authUser)
    .where(like(authUser.email, `%@${TEST_EMAIL_DOMAIN}`));
  await db
    .delete(authVerification)
    .where(like(authVerification.identifier, `%@${TEST_EMAIL_DOMAIN}`));
}
