// Global type declarations for Clerk auth
// Create a type for the roles
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
