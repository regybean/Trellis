'use client';

import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

/**
 * The viewer's auth state as features are allowed to see it: an opaque id and
 * two booleans. No provider vocabulary — no session claims, no Better Auth
 * session row.
 *
 * `isLoaded` is separate from `isSignedIn` because "we don't know yet" and
 * "signed out" have to drive different UI: a query gated on `isSignedIn` alone
 * would fire (and 401) during the first client render, and a CTA would flash the
 * signed-out state before resolving.
 *
 * A **union of the three reachable states**, not a record of three independent
 * fields. The flat version could represent `{ userId: null, isSignedIn: true }`
 * and `{ isLoaded: false, isSignedIn: true }` — states no provider can produce
 * but every consumer still has to defend against. Here `userId` is a `string`
 * exactly when `isSignedIn` is `true`, so `if (status.isSignedIn)` narrows it
 * and no consumer needs a `?? ''` or a non-null assertion.
 *
 * Build one with {@link loadingAuthStatus} / {@link resolvedAuthStatus} rather
 * than by hand — an app that assembles the fields itself is back to keeping the
 * three in agreement on its own.
 */
export type AuthStatus =
  | { isLoaded: false; isSignedIn: false; userId: null }
  | { isLoaded: true; isSignedIn: false; userId: null }
  | { isLoaded: true; isSignedIn: true; userId: string };

/** Before the provider has resolved a session even once. */
export const loadingAuthStatus: AuthStatus = {
  isLoaded: false,
  isSignedIn: false,
  userId: null,
};

/**
 * A resolved session, from the one thing the app knows after resolving it: the
 * viewer's id, or `null` for a signed-out visitor.
 */
export function resolvedAuthStatus(userId: string | null): AuthStatus {
  return userId === null
    ? { isLoaded: true, isSignedIn: false, userId: null }
    : { isLoaded: true, isSignedIn: true, userId };
}

const AuthStatusContext = createContext<AuthStatus | null>(null);

/**
 * The client half of the app-owned auth seam (ADR 0003). The *app* resolves the
 * session with whatever provider it uses — Better Auth's `useSession` in both
 * full apps, seeded from the server-resolved id — and feeds the result in here;
 * features read it back through `useAuthStatus` and never learn which provider
 * is mounted.
 *
 * This is the same arrangement `useClearCacheOnLogout` already uses (the app
 * passes a plain `isSignedIn` boolean), generalised so a feature can read the
 * state rather than only receive it as a prop. Keeping it in `@acme/hooks`
 * rather than `@acme/auth` is deliberate: `@acme/auth` ships no React
 * (ADR 0034), and the substrate must not pull an auth provider into the graph of
 * the slim, no-auth apps (ADR 0010).
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
