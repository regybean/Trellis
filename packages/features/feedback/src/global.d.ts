// Global type declarations for the auth seam. Roles is owned by @acme/auth —
// import it rather than redeclaring.
import type { Roles } from '@acme/auth';

declare global {
  // `ctx.session.user` shape. The platform declares this augmentable interface
  // and reads only `id` + `role`; feedback reads no further user fields, so
  // this mirrors the platform base rather than sharpening it. See @acme/trpc.
  interface InjectedUser {
    id: string;
    role?: Roles;
  }
}
