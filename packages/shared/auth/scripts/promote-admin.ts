/* eslint-disable no-restricted-syntax */
/**
 * Promote a user to `admin` by email, against the local development database.
 *
 * The first admin is a database write by definition: the promote endpoint is
 * itself admin-gated, so there is no one to authorise the first one. That left
 * raw SQL as the only documented answer, which is a poor instruction to hand
 * someone — the same statement pasted into the wrong console promotes a
 * stranger in production.
 *
 * So this exists, and it refuses to run anywhere but development. `APP_ENV`
 * unset or `development` is the local stack; anything else exits non-zero
 * without touching a row. Demotion is deliberately absent, because `/admin` has
 * a UI for it once the first admin exists.
 *
 * The guard runs *before* `@acme/db` is imported, and that ordering is the
 * point: importing it evaluates the slice's env, which on a deploy target
 * demands `DB_HOST` and throws. A static import would therefore fail with an
 * env error naming a key the operator did not ask about, instead of this
 * script's own refusal — the guard would still hold, but it would never get to
 * say why.
 *
 * Run via `pnpm promote:admin <email>`.
 */
const appEnv = process.env.APP_ENV ?? 'development';
if (appEnv !== 'development') {
  console.error(
    `promote:admin refuses to run with APP_ENV=${appEnv}. It is a local dev convenience; grant roles through /admin on a real deployment.`,
  );
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: pnpm promote:admin <email>');
  process.exit(1);
}

const { eq } = await import('drizzle-orm');
const { createDb } = await import('@acme/db');
const { authUser } = await import('../src/schemas/auth-schema');

const db = createDb();

const [promoted] = await db
  .update(authUser)
  .set({ role: 'admin' })
  .where(eq(authUser.email, email))
  .returning({ email: authUser.email, role: authUser.role });

if (!promoted) {
  console.error(
    `No user with email ${email}. Sign up in the app first, then run this again.`,
  );
  process.exit(1);
}

console.log(`${promoted.email} is now ${promoted.role}.`);
process.exit(0);
