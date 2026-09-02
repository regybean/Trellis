import type { ReactNode } from 'react';

import { useAuth } from '@acme/auth';
import { AuthStatusProvider } from '@acme/hooks';

/**
 * This app's half of the client auth seam (`@acme/hooks`): maps Clerk's
 * `useAuth()` onto the neutral `AuthStatus` the features read. Features — chiefly
 * `@acme/billing`, which gates its viewer-scoped queries on it — never learn
 * which provider is mounted.
 *
 * `apps/nextjs` supplies the same seam from Better Auth's `useSession` (#223).
 * This app stays on Clerk until its own migration ticket, so the mapping lives
 * here rather than in a shared package: the *app* owns auth resolution
 * (ADR 0003), which is exactly what lets the two full apps run different
 * providers at the same time.
 */
export function ClerkAuthStatusProvider({ children }: { children: ReactNode }) {
  const { userId, isSignedIn, isLoaded } = useAuth();

  return (
    <AuthStatusProvider
      status={{
        userId: userId ?? null,
        isSignedIn: Boolean(isSignedIn),
        isLoaded,
      }}
    >
      {children}
    </AuthStatusProvider>
  );
}
