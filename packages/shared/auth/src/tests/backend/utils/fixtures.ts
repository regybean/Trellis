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
 * `NEXT_PUBLIC_WEBAPP` schemas
 * ([ADR 0002](../../../../docs/adr/0002-auth-tables-in-a-dedicated-schema.md))
 * — on the local compose path that is a developer's actual identity table, so a
 * blanket `DELETE FROM auth.user` would wipe real rows. `session` and `account`
 * cascade from `user`.
 */
export const TEST_EMAIL_DOMAIN = 'auth-suite.invalid';

/** Arbitrary — no request ever leaves, but Better Auth insists on an origin. */
export const BASE_URL = 'http://localhost:3000';

/** The default instance under test: what an app that passes no options gets. */
export const auth = initAuth({ baseUrl: BASE_URL });

/** A second handle on the same database, for asserting on rows directly. */
export const db = createDb();

let counter = 0;

/** A unique address per call, so tests don't collide on `user.email`'s unique. */
export function testEmail(label: string) {
  counter += 1;
  return `${label}-${counter}@${TEST_EMAIL_DOMAIN}`;
}

/**
 * Throwaway credential for the users this suite creates — not a secret. Named
 * like the `@acme/db/testing` container credentials so it reads as an identifier
 * rather than an inline password literal. Over Better Auth's 8-char minimum.
 *
 * Exported because the cases that build a variant instance (a different plugin
 * list, the credential provider off) call its endpoints directly rather than
 * through the helpers below, which are bound to the default instance.
 */
export const TEST_SECRET = 'correct-horse-battery';

export async function signUp(email: string) {
  const { user } = await auth.api.signUpEmail({
    body: { name: `Test ${email}`, email, password: TEST_SECRET },
  });
  return user;
}

/**
 * The `Cookie` header a subsequent request would carry, from the `Set-Cookie`
 * headers a sign-in returned. `getSession` reads the session token out of it
 * exactly as a browser request would — which is what makes this suite exercise
 * the real cookie→row lookup rather than an internal helper.
 */
export function toCookieHeader(headers: Headers) {
  const cookies = headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
  return new Headers({ cookie: cookies });
}

/** Sign in to the default instance and return that `Cookie` header. */
export async function signInAndGetHeaders(email: string) {
  const { headers } = await auth.api.signInEmail({
    body: { email, password: TEST_SECRET },
    returnHeaders: true,
  });
  return toCookieHeader(headers);
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
