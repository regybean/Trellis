// Global type declarations for Clerk auth
import type { User } from '@clerk/nextjs/server';

// Create a type for the roles
export type Roles = 'admin' | 'user';

declare global {
  interface CustomJwtSessionClaims {
    metadata: {
      role?: Roles;
    };
  }

  // Billing's account router reads `ctx.user.primaryEmailAddress`, so it
  // augments the platform's open `InjectedUser` to the concrete Clerk `User`.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface InjectedUser extends User {}
}
