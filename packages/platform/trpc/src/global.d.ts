// Global type declarations for Clerk auth.
// NOTE: @acme/trpc is a platform package; it cannot depend on @acme/auth (shared
// layer). Roles and CustomJwtSessionClaims must be redeclared here. Features that
// can depend on @acme/auth should import Roles from there instead of redeclaring.
export type Roles = 'admin' | 'user';

declare global {
  interface CustomJwtSessionClaims {
    metadata: {
      role?: Roles;
    };
  }

  // The injected user shape for `ctx.user`. Open by design: the platform reads
  // no user fields, so the base is empty. Apps/features that need the concrete
  // user augment this interface (the full apps & `@acme/billing` merge in a
  // Clerk `User`); a no-auth build can augment it to its own user shape.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface InjectedUser {}
}
