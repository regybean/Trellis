// Global type declarations for Clerk auth
import type { User } from '@clerk/backend';

// Create a type for the roles
export type Roles = 'admin' | 'user';

declare global {
  interface CustomJwtSessionClaims {
    metadata: {
      role?: Roles;
    };
  }

  // The canonical `ctx.user` augmentation for the full apps: both apps include
  // this file in their tsconfig, so injecting a Clerk `currentUser()` result is
  // type-checked against the real `User`. The platform owns the open base
  // interface (see @acme/trpc); this sharpens it.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface InjectedUser extends User {}
}
