'use client';

import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

/**
 * The viewer's auth state as features are allowed to see it: an opaque id and
 * two booleans. No provider vocabulary — no Clerk session claims, no Better Auth
 * session row.
 *
 * `isLoaded` is separate from `isSignedIn` because "we don't know yet" and
 * "signed out" have to drive different UI: a query gated on `isSignedIn` alone
 * would fire (and 401) during the first client render, and a CTA would flash the
 * signed-out state before resolving.
 */
export interface AuthStatus {
  /** The signed-in user's id, or `null` when signed out or still resolving. */
  userId: string | null;
  isSignedIn: boolean;
  /** `false` until the auth provider has resolved the session at least once. */
  isLoaded: boolean;
}

const AuthStatusContext = createContext<AuthStatus | null>(null);

/**
 * The client half of the app-owned auth seam (ADR 0003). The *app* resolves the
 * session with whatever provider it uses — Better Auth's `useSession` in
 * `apps/nextjs`, Clerk's `useAuth` in `apps/tanstack-start` — and feeds the
 * result in here; features read it back through `useAuthStatus` and never learn
 * which provider is mounted.
 *
 * This is the same arrangement `useClearCacheOnLogout` already uses (the app
 * passes a plain `isSignedIn` boolean), generalised so a feature can read the
 * state rather than only receive it as a prop. Keeping it in `@acme/hooks`
 * rather than `@acme/auth` is deliberate: `@acme/auth` ships no React
 * ([ADR 0034](../../../../docs/adr/0034-better-auth-replaces-clerk.md)), and the
 * substrate must not pull an auth provider into the graph of the slim, no-auth
 * apps (ADR 0010).
 */
export function AuthStatusProvider({
  status,
  children,
}: {
  status: AuthStatus;
  children: ReactNode;
}) {
  return (
    <AuthStatusContext.Provider value={status}>
      {children}
    </AuthStatusContext.Provider>
  );
}

/**
 * Read the viewer's auth state. Throws when no `AuthStatusProvider` is mounted,
 * rather than defaulting to signed-out: a missing provider is an app wiring bug,
 * and the silent version of it is a feature whose queries never enable and whose
 * CTAs never light up — a bug that looks exactly like "the user is logged out".
 */
export function useAuthStatus() {
  const status = useContext(AuthStatusContext);

  if (!status) {
    throw new Error(
      'useAuthStatus must be used within an <AuthStatusProvider>. The app owns auth resolution and supplies it (ADR 0003).',
    );
  }

  return status;
}
