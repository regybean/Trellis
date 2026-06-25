'use client';

export const name = 'auth';

/**
 * Framework-neutral Clerk *client* surface. The *app* owns `<ClerkProvider>`
 * (Next.js via `@clerk/nextjs`, TanStack Start via
 * `@clerk/tanstack-react-start`); features and apps import auth UI + hooks from
 * here, never from a framework-specific Clerk SDK. This keeps the vertical
 * slices portable across apps.
 *
 * The `'use client'` directive is load-bearing: it stops the Next RSC graph
 * from evaluating `@clerk/clerk-react` → `@clerk/shared` → `swr`, which under
 * the `react-server` export condition has no default export and breaks the
 * build. Backend code lives in `@acme/auth/server` (no client boundary).
 * See docs/adr/0003-framework-agnostic-auth-seam.md.
 */
export {
  SignedIn,
  SignedOut,
  SignIn,
  SignInButton,
  SignUp,
  SignUpButton,
  UserButton,
  useAuth,
  useUser,
} from '@clerk/clerk-react';

export type { SerializableUser } from './types/admin';
export type * from './types/globals';
