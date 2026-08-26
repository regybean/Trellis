// Global type declarations for the platform's injected principal. No auth
// provider is named: `@acme/trpc` owns the `InjectedUser` seam, and a feature's
// program can't include the platform's own `global.d.ts`, so the base is
// redeclared here. `Roles` is owned by @acme/auth — imported, not redeclared.
import type { Roles } from '@acme/auth';

declare global {
  // `ctx.session.user`. Billing's account router opens a Stripe customer for the
  // caller, so it augments the platform's base with the primary email address —
  // structurally, naming no provider. The full apps map it off their auth
  // provider's user (see @acme/auth's globals).
  interface InjectedUser {
    id: string;
    role?: Roles;
    primaryEmailAddress: { emailAddress: string } | null;
  }
}
