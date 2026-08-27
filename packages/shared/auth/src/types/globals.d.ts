// Global type declarations for the auth seam.
import type { User } from '@clerk/backend';

// Create a type for the roles
export type Roles = 'admin' | 'user';

declare global {
  // The canonical `ctx.session.user` augmentation for the full apps: both apps
  // include this file in their tsconfig, so the session they inject is
  // type-checked against the real provider `User`. The platform owns the base
  // interface — `id` + `role`, the only fields it reads (see @acme/trpc); this
  // sharpens it. `id` comes from `User`.
  interface InjectedUser extends User {
    role?: Roles;
  }
}
