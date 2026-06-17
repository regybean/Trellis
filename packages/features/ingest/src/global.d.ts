// Global type declarations for Clerk auth
// Create a type for the roles
export type Roles = 'admin' | 'user';

declare global {
  interface CustomJwtSessionClaims {
    metadata: {
      role?: Roles;
    };
  }

  // `ctx.user` shape. The platform declares this open interface; ingest reads no
  // user fields, so the base (empty) is enough. See @acme/trpc.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface InjectedUser {}
}
