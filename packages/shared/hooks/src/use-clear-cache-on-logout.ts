'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Wipes the app's caches when a signed-in user logs out on a shared machine
 * (`isSignedIn` transitions true → false): every persisted store (via the
 * injected `clearStore`) *and* the in-memory QueryClient read from context.
 * `buster` (appVersion:scopeKey) already blocks cross-account *reads*; this
 * removes the departing user's data outright.
 *
 * Scope is the whole app, not one feature (ADR 0036): there is a single
 * `QueryClient`, so `clear()` empties every mounted feature at once. Render this
 * **once** per app and have `clearStore` clear the persisted store of each
 * feature that app mounts — chat history, feedback and documents all have to go,
 * and splitting the call per feature would only clear the same cache repeatedly.
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
