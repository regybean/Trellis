/**
 * Better Auth against a real Postgres.
 *
 * This is the demo for the self-hosted instance: a user can be created and
 * signed in with an email and password, a session resolves from the cookie, and
 * the hand-authored tables in the `auth` schema are what all of it reads and
 * writes. See ADR 0034 (the self-hosted provider) and ADR 0035 (the `auth`
 * schema).
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { authSession, authUser } from '../../../../schemas/auth-schema';
import {
  auth,
  db,
  signInAndGetHeaders,
  signUp,
  testEmail,
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
