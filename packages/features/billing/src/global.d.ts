// Global type declarations for the auth seam. Roles is owned by @acme/auth —
// import it rather than redeclaring.
import type { User } from '@clerk/nextjs/server';

import type { Roles } from '@acme/auth';

declare global {
  // Billing's account router reads `ctx.session.user.primaryEmailAddress`, so it
  // sharpens the platform's `InjectedUser` to the concrete provider `User`. `id`
  // comes from `User`; `role` is the platform's own gate field.
  interface InjectedUser extends User {
    role?: Roles;
  }
}
