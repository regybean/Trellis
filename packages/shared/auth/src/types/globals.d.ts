// Provider-specific global type declarations for the two full apps. Both include
// this file in their tsconfig, so it — and only it — sharpens the platform's
// neutral `InjectedUser` seam (`@acme/trpc`) with the fields these apps map off
// a Clerk `User`. Swapping Clerk out is a change to this file, not to the
// platform or any feature.
import type { User } from '@clerk/backend';

// Create a type for the roles
export type Roles = 'admin' | 'user';

declare global {
  // The `ctx.session.user` shape the full apps inject: the platform's `id` +
  // `role` base, plus the primary email `@acme/billing` needs for its Stripe
  // customer lookup. Typed off the real Clerk `User` so a renamed provider field
  // is a compile error, but structural — the app maps a principal rather than
  // handing the Clerk class instance to the substrate.
  interface InjectedUser extends Pick<User, 'id' | 'primaryEmailAddress'> {
    role?: Roles;
  }
}
