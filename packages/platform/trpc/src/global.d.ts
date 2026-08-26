// The injected principal seam. No auth provider is named here: the platform
// declares the shape it consumes, and each app maps its own provider's session
// into it at the edge (see docs/adr/0003-framework-agnostic-auth-seam.md).
//
// NOTE: @acme/trpc is a platform package; it cannot depend on @acme/auth (shared
// layer), so `Roles` is declared here. Packages that can depend on @acme/auth
// import `Roles` from there instead of redeclaring it.
export type Roles = 'admin' | 'user';

declare global {
  // The injected user shape for `ctx.session.user`. Open by design: the platform
  // reads only `id` (identity) and `role` (the `adminProcedure` gate), so the
  // base declares exactly those. Apps/features that need more augment this
  // interface — the full apps sharpen it through @acme/auth, `@acme/billing`
  // adds the primary email its Stripe customer lookup needs. A program that
  // consumes a feature's `createTRPCContext` must have this interface in scope:
  // the full apps include @acme/auth's `globals.d.ts`, the slim apps include
  // this file.
  interface InjectedUser {
    id: string;
    role?: Roles;
  }
}
