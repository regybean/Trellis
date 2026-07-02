// Global type declarations for Clerk auth.
// Roles is owned by @acme/auth — import it rather than redeclaring.
import type { User } from '@clerk/nextjs/server';

import type { Roles } from '@acme/auth';

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
