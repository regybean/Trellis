// Global type declarations for Clerk auth.
// Roles is owned by @acme/auth — import it rather than redeclaring.
import type { Roles } from '@acme/auth';

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
