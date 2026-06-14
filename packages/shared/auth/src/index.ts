export const name = 'auth';

/**
 * Framework-neutral Clerk client surface. The *app* owns `<ClerkProvider>`
 * (Next.js via `@clerk/nextjs`, TanStack Start via
 * `@clerk/tanstack-react-start`); features and compositions import auth UI +
 * hooks from here, never from a framework-specific Clerk SDK. This keeps the
 * vertical slices portable across apps.
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

export * from './types/admin';
export type * from './types/globals';
