import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Wipes the enclosing feature's caches when a signed-in user logs out on a
 * shared machine (`isSignedIn` transitions true → false): its persisted store
 * (via the injected `clearStore`) *and* its in-memory QueryClient (read from
 * context, so it's the feature's own client — no feature change needed).
 * `buster` (appVersion:scopeKey) already blocks cross-account *reads*; this
 * removes the departing user's data outright.
 *
 * Auth-agnostic by design: the caller passes a plain `isSignedIn` boolean, so
 * this stays in the substrate without coupling `@acme/hooks` to `@acme/auth`
 * (ADR 0010 — the slim, no-auth apps must not pull an auth provider into the
 * graph). The *app* owns auth and feeds the transition in. Watching the
 * transition, rather than hanging off a sign-out button's `onClick`, is what
 * keeps this hook framework- and provider-neutral.
 */
export function useClearCacheOnLogout(
  isSignedIn: boolean,
  clearStore: () => Promise<void>,
) {
  const queryClient = useQueryClient();
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (isSignedIn) {
      wasSignedIn.current = true;
      return;
    }
    if (wasSignedIn.current) {
      wasSignedIn.current = false;
      queryClient.clear();
      void clearStore();
    }
  }, [isSignedIn, queryClient, clearStore]);
}
