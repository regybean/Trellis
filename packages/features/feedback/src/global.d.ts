// Global type declarations for Clerk auth.
// Augments Clerk's session claims so `auth().sessionClaims.metadata.role` is typed.
export type Roles = 'admin' | 'user';

declare global {
  interface CustomJwtSessionClaims {
    metadata: {
      role?: Roles;
    };
  }
}
