// Global type declarations for Clerk auth.
// Augments Clerk's session claims so `auth().sessionClaims.metadata.role` is typed.
export type Roles = 'admin' | 'user';

declare global {
  interface CustomJwtSessionClaims {
    metadata: {
      role?: Roles;
    };
  }

  // `ctx.user` shape. The platform declares this open interface; feedback reads
  // no user fields, so the base (empty) is enough. See @acme/trpc.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface InjectedUser {}
}
