// Clerk's session-claim augmentation. This is *provider* vocabulary, so it lives
// in the app that owns the Clerk adapter rather than in `@acme/auth` or
// `@acme/trpc`: the platform's session seam is neutral (`InjectedSession`), and
// the role is mapped off this claim onto the injected user in
// `src/server/trpc-route.ts`. See docs/adr/0003-framework-agnostic-auth-seam.md.
//
// This file goes away with Clerk itself.
import type { Roles } from '@acme/auth';

declare global {
  interface CustomJwtSessionClaims {
    metadata: {
      role?: Roles;
    };
  }
}
