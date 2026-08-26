// Global type declarations for the platform's injected principal. No auth
// provider is named: `@acme/trpc` owns the `InjectedUser` seam, and this
// package's program can't include the platform's own `global.d.ts`, so the base
// is redeclared here (`@acme/notifications` sits below `@acme/auth`, so the
// role union is declared rather than imported).
export type Roles = 'admin' | 'user';

declare global {
  // `ctx.session.user`. The `stream` subscription reads only the id; `role` is
  // the base field `adminProcedure` gates on. See @acme/trpc.
  interface InjectedUser {
    id: string;
    role?: Roles;
  }
}
