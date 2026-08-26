// Global type declarations for the platform's injected principal. No auth
// provider is named: `@acme/trpc` owns the `InjectedUser` seam, and a feature's
// program can't include the platform's own `global.d.ts`, so the base is
// redeclared here. `Roles` is owned by @acme/auth — imported, not redeclared.
import type { Roles } from '@acme/auth';

declare global {
  // `ctx.session.user`. Chat reads only the id; `role` is the base field
  // `adminProcedure` gates on. See @acme/trpc.
  interface InjectedUser {
    id: string;
    role?: Roles;
  }
}
