/**
 * Better Auth against a real Postgres.
 *
 * This is the demo for the self-hosted instance: a user can be created and
 * signed in with an email and password, a session resolves from the cookie, and
 * the hand-authored tables in the `auth` schema are what all of it reads and
 * writes. See
 * [ADR 0001](../../../../../docs/adr/0001-self-hosted-better-auth.md) (the
 * self-hosted provider) and
 * [ADR 0002](../../../../../docs/adr/0002-auth-tables-in-a-dedicated-schema.md)
 * (the `auth` schema).
 */
import { oneTimeToken } from 'better-auth/plugins/one-time-token';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { initAuth } from '../../../../init-auth';
import { authSession, authUser } from '../../../../schemas/auth-schema';
import {
  auth,
  BASE_URL,
  db,
  signInAndGetHeaders,
  signUp,
  TEST_SECRET,
  testEmail,
  toCookieHeader,
} from '../../utils/fixtures';

/**
 * Rows from `information_schema.tables`, as `db.execute` hands them back. The
 * `Record` in the extends clause is `db.execute`'s own generic constraint — an
 * interface has no implicit index signature, so it has to be declared.
 */
interface TableRow extends Record<string, unknown> {
  table_schema: string;
  table_name: string;
}

describe('better auth instance', () => {
  it('puts its four tables in the auth schema, not the per-app schema', async () => {
    const perAppSchema = process.env.NEXT_PUBLIC_WEBAPP;
    const rows = await db.execute<TableRow>(sql`
      select table_schema, table_name
      from information_schema.tables
      where table_name in ('user', 'session', 'account', 'verification')
        and table_schema in ('auth', ${perAppSchema})
    `);

    const located = rows.map((row) => `${row.table_schema}.${row.table_name}`);
    expect(located.toSorted((a, b) => a.localeCompare(b))).toEqual([
      'auth.account',
      'auth.session',
      'auth.user',
      'auth.verification',
    ]);
  });

  it('resolves a session for a user who signs up and signs in', async () => {
    const email = testEmail('signin');
    const created = await signUp(email);

    const headers = await signInAndGetHeaders(email);
    const session = await auth.api.getSession({ headers });

    expect(session?.user.id).toBe(created.id);
    expect(session?.user.email).toBe(email);
  });

  it('stops resolving a session once its row is deleted', async () => {
    const email = testEmail('revoke');
    const created = await signUp(email);
    const headers = await signInAndGetHeaders(email);

    expect(await auth.api.getSession({ headers })).not.toBeNull();

    // The proof that sessions are database rows and not a stateless cookie: the
    // cookie is byte-for-byte unchanged, and the same request now resolves to
    // nothing.
    await db.delete(authSession).where(eq(authSession.userId, created.id));

    expect(await auth.api.getSession({ headers })).toBeNull();
  });

  it('defaults a new user to the admin plugin role', async () => {
    const created = await signUp(testEmail('default-role'));

    const [row] = await db
      .select({ role: authUser.role })
      .from(authUser)
      .where(eq(authUser.id, created.id));

    expect(row?.role).toBe('user');
  });

  it('persists a role set through the admin plugin and reads it back on the session', async () => {
    const adminEmail = testEmail('admin');
    const adminUser = await signUp(adminEmail);
    // Seeding the first admin is a database write by definition — `setRole`
    // requires an existing admin to call it.
    await db
      .update(authUser)
      .set({ role: 'admin' })
      .where(eq(authUser.id, adminUser.id));

    const adminHeaders = await signInAndGetHeaders(adminEmail);
    const adminSession = await auth.api.getSession({ headers: adminHeaders });
    // `toMatchObject` rather than `.user.role`: Better Auth types `getSession`
    // as returning the core columns only, so the plugin's field is present at
    // runtime but absent from that return type. This asserts the payload really
    // carries it — which is what `Session`'s `UserWithRole` intersection claims.
    expect(adminSession?.user).toMatchObject({ role: 'admin' });

    const member = await signUp(testEmail('promoted'));
    await auth.api.setRole({
      body: { userId: member.id, role: 'admin' },
      headers: adminHeaders,
    });

    const [row] = await db
      .select({ role: authUser.role })
      .from(authUser)
      .where(eq(authUser.id, member.id));
    expect(row?.role).toBe('admin');
  });
});

/**
 * The two decisions `initAuth` hands to its caller. Both variants are built
 * through the same factory against the same real Postgres as the default
 * instance above — nothing here mocks Better Auth or reaches into the options
 * object to assert on its shape.
 */
describe('a caller-configured instance', () => {
  it('refuses a password sign-up when the credential provider is off', async () => {
    const passwordless = initAuth({
      baseUrl: BASE_URL,
      emailAndPassword: false,
    });
    const email = testEmail('no-credentials');

    await expect(
      passwordless.api.signUpEmail({
        body: { name: `Test ${email}`, email, password: TEST_SECRET },
      }),
    ).rejects.toThrow(/not enabled/i);
  });

  it('still serves the built-in admin behaviour with a plugin appended', async () => {
    const withExtra = initAuth({
      baseUrl: BASE_URL,
      plugins: [oneTimeToken()],
    });

    const adminEmail = testEmail('appended-admin');
    const { user: adminUser } = await withExtra.api.signUpEmail({
      body: {
        name: `Test ${adminEmail}`,
        email: adminEmail,
        password: TEST_SECRET,
      },
    });
    // Seeding the first admin is a database write by definition, as above.
    await db
      .update(authUser)
      .set({ role: 'admin' })
      .where(eq(authUser.id, adminUser.id));

    const { headers } = await withExtra.api.signInEmail({
      body: { email: adminEmail, password: TEST_SECRET },
      returnHeaders: true,
    });
    const adminHeaders = toCookieHeader(headers);

    const member = await signUp(testEmail('appended-member'));
    await withExtra.api.setRole({
      body: { userId: member.id, role: 'admin' },
      headers: adminHeaders,
    });

    const [row] = await db
      .select({ role: authUser.role })
      .from(authUser)
      .where(eq(authUser.id, member.id));
    expect(row?.role).toBe('admin');
  });

  it('serves the appended plugin its own endpoint', async () => {
    const withExtra = initAuth({
      baseUrl: BASE_URL,
      plugins: [oneTimeToken()],
    });

    const email = testEmail('appended-endpoint');
    await withExtra.api.signUpEmail({
      body: { name: `Test ${email}`, email, password: TEST_SECRET },
    });
    const { headers } = await withExtra.api.signInEmail({
      body: { email, password: TEST_SECRET },
      returnHeaders: true,
    });

    // `generateOneTimeToken` is the plugin's, not a built-in: this line only
    // compiles because the tuple the caller passed stayed visible in the
    // instance's type instead of widening away to `BetterAuthPlugin[]`. So the
    // case covers the runtime reach and the typing of it at once.
    const { token } = await withExtra.api.generateOneTimeToken({
      headers: toCookieHeader(headers),
    });

    expect(token).toBeTruthy();
  });
});
