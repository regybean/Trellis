/**
 * The role vocabulary the platform's admin gate reads off the session user
 * (`ctx.session.user.role`, see `@acme/trpc`).
 *
 * Deliberately a real `.ts` module rather than a member of `globals.d.ts`:
 * `tsc` does not copy `.d.ts` inputs into `dist`, so a type declared there is
 * unresolvable for every consumer that imports it through the package barrel.
 */
export type Roles = 'admin' | 'user';
