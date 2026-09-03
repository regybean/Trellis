/**
 * The provider→neutral mappings, against sessions a real Better Auth resolves.
 *
 * These three used to exist twice, once per app (#237 and #238 each wrote their
 * own); #239 collapsed them here, so this is where a promote/demote is proved to
 * reach the admin gate — through one implementation, for both apps. Nothing is
 * mocked: the role comes back on a session resolved from a real cookie against a
 * real Postgres, which is the only way to exercise the gap this code exists to
 * cross (Better Auth omits the admin plugin's columns from `getSession`'s static
 * type, so the value is there and the type says otherwise).
 */
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { requireAdmin } from '@acme/trpc';
import { createMockSession } from '@acme/trpc/testing';

import {
  readSessionRole,
  toAdminUser,
  toPrincipal,
} from '../../../../principal';
import { authUser } from '../../../../schemas/auth-schema';
import {
  auth,
  db,
  signInAndGetHeaders,
  signUp,
  testEmail,
} from '../../utils/fixtures';

/** Sign up, seed to admin by direct write, and return a signed-in header set. */
async function signedInAdmin() {
  const email = testEmail('principal-admin');
  const user = await signUp(email);
  // Seeding the first admin is a database write by definition — `setRole`
  // requires an existing admin to call it.
  await db
    .update(authUser)
    .set({ role: 'admin' })
    .where(eq(authUser.id, user.id));
  return signInAndGetHeaders(email);
}

/** Sign up, sign in, and resolve the session the way a request handler would. */
async function signedInSession(label: string) {
  const email = testEmail(label);
  const created = await signUp(email);
  const headers = await signInAndGetHeaders(email);
  const session = await auth.api.getSession({ headers });

  if (!session) throw new Error(`no session resolved for ${email}`);

  return { email, created, headers, session };
}

describe('readSessionRole', () => {
  it('follows a promotion and a demotion on the resolved session', async () => {
    const adminHeaders = await signedInAdmin();
    const { created, headers } = await signedInSession('principal-member');

    const currentRole = async () => {
      const session = await auth.api.getSession({ headers });
      return session ? readSessionRole(session.user) : null;
    };

    expect(await currentRole()).toBe('user');

    await auth.api.setRole({
      body: { userId: created.id, role: 'admin' },
      headers: adminHeaders,
    });
    expect(await currentRole()).toBe('admin');

    // Demotion is `setRole(…, 'user')`, not a clear: the column has a
    // `defaultRole`, so plain membership *is* a role (ADR 0001).
    await auth.api.setRole({
      body: { userId: created.id, role: 'user' },
      headers: adminHeaders,
    });
    expect(await currentRole()).toBe('user');
  });

  it('reads no role off a row whose column holds something unrecognised', async () => {
    const { created, headers } = await signedInSession('principal-bogus');
    await db
      .update(authUser)
      .set({ role: 'superuser' })
      .where(eq(authUser.id, created.id));

    const session = await auth.api.getSession({ headers });

    // Fails closed rather than propagating a value `Roles` cannot mean.
    expect(session && readSessionRole(session.user)).toBeNull();
  });

  it('rejects a resolved session where a user row is expected', async () => {
    const { session } = await signedInSession('principal-shape');

    // The bug this signature exists to stop: `{ session, user }` is not a user
    // row, and passing it silently degraded every caller to non-admin back when
    // the parameter was `unknown`. The assertion is the compile error itself —
    // `@ts-expect-error` fails the typecheck if this line ever starts working.
    // @ts-expect-error — a session is not a user row.
    readSessionRole(session);

    expect(readSessionRole(session.user)).toBe('user');
  });
});

describe('toPrincipal', () => {
  it('carries the id, the role and the email the substrate gates on', async () => {
    const { email, created, session } = await signedInSession('principal-map');

    expect(toPrincipal(session)).toEqual({
      id: created.id,
      role: 'user',
      email,
    });
  });

  it('maps a signed-out caller to no principal', () => {
    expect(toPrincipal(null)).toBeNull();
  });
});

describe('toAdminUser', () => {
  it('shapes a listed user for the admin widget', async () => {
    const adminHeaders = await signedInAdmin();
    const { email, created } = await signedInSession('principal-listed');

    const { users } = await auth.api.listUsers({
      query: {
        searchField: 'email',
        searchOperator: 'contains',
        searchValue: email,
      },
      headers: adminHeaders,
    });
    const [listed] = users;

    expect(listed?.id).toBe(created.id);
    // Every field is one Better Auth stores; the fabricated fields the old
    // adapter produced are gone with the widget that wanted them (#225).
    expect(listed && toAdminUser(listed)).toEqual({
      id: created.id,
      name: `Test ${email}`,
      email,
      emailVerified: false,
      image: null,
      createdAt: created.createdAt,
      role: 'user',
    });
  });

  it('reports a promoted user as admin', async () => {
    const adminHeaders = await signedInAdmin();
    const { email, created } = await signedInSession('principal-promoted');

    await auth.api.setRole({
      body: { userId: created.id, role: 'admin' },
      headers: adminHeaders,
    });

    const { users } = await auth.api.listUsers({
      query: {
        searchField: 'email',
        searchOperator: 'contains',
        searchValue: email,
      },
      headers: adminHeaders,
    });
    const [listed] = users;

    expect(listed && toAdminUser(listed).role).toBe('admin');
  });
});

/**
 * The whole chain the admin surface rests on, in one place: a role written by
 * `setRole` lands in a column, comes back on a session resolved from a real
 * cookie, survives `toPrincipal`, and decides the admin gate.
 *
 * The per-feature `adminProcedure` tests hand the gate a principal with the role
 * already set, which proves the gate reads `role` but not that a *promotion*
 * ever produces that principal. This test owns that half of the chain, and its
 * subject is `requireAdmin` — the gate body itself, called exactly as each
 * feature's `admin` middleware calls it.
 *
 * It deliberately builds no tRPC instance. `@acme/auth` is a `shared` package,
 * so it cannot import a feature's real `adminProcedure` (features sit above
 * it), and hand-rolling one here would be a sixth copy of the middleware wiring
 * — one with no telemetry and no timing, i.e. not the stack any feature
 * actually runs, sitting in the one file the generator can't keep in step
 * (#264, #265 review). The procedure envelope adds nothing this test asserts
 * on: what turns a role into a decision is `requireAdmin`, and the five
 * features already prove their `adminProcedure` is built from it.
 */

/**
 * The gate's verdict for whoever this session belongs to: the admitted
 * principal's id, or the `TRPCError` code it refused with. One value for both
 * outcomes, so a promotion and a demotion read as the same assertion twice.
 */
function verdictFor(session: Parameters<typeof toPrincipal>[0]) {
  const user = toPrincipal(session);

  // Not an assertion for the test's benefit: the gate reads a session that has
  // a principal on it, and a signed-out caller has none. The callers below are
  // all signed in, so reaching this is a broken fixture, not a failed
  // expectation.
  if (!user) throw new Error('expected a signed-in session');

  try {
    return requireAdmin(createMockSession(user)).id;
  } catch (error) {
    if (error instanceof TRPCError) return error.code;
    throw error;
  }
}

describe('the admin gate', () => {
  it('admits a promoted user and refuses them again once demoted', async () => {
    const adminHeaders = await signedInAdmin();
    const { created, headers } = await signedInSession('principal-gate');

    const currentSession = () => auth.api.getSession({ headers });
    const setRole = (role: 'admin' | 'user') =>
      auth.api.setRole({
        body: { userId: created.id, role },
        headers: adminHeaders,
      });

    expect(verdictFor(await currentSession())).toBe('UNAUTHORIZED');

    await setRole('admin');
    expect(verdictFor(await currentSession())).toBe(created.id);

    await setRole('user');
    expect(verdictFor(await currentSession())).toBe('UNAUTHORIZED');
  });

  it('refuses a caller whose role column holds something unrecognised', async () => {
    const { created, headers } = await signedInSession('principal-gate-bogus');
    await db
      .update(authUser)
      .set({ role: 'superuser' })
      .where(eq(authUser.id, created.id));

    // `readSessionRole` fails closed, so the gate never sees a role it cannot
    // mean — a value the database will happily hold, since the column is text.
    expect(verdictFor(await auth.api.getSession({ headers }))).toBe(
      'UNAUTHORIZED',
    );
  });
});
