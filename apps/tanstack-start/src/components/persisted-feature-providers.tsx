import type { ReactNode } from 'react';

import { ChatTRPCProvider, clearChatPersistedCache } from '@acme/chat';
import {
  clearPersistedCache as clearFeedbackPersistedCache,
  FeedbackTRPCProvider,
} from '@acme/feedback';
import { useClearCacheOnLogout } from '@acme/hooks';
import { clearIngestPersistedCache, IngestTRPCProvider } from '@acme/ingest';

/**
 * Every persisted store this app mounts. Module-level so its identity is stable
 * across renders (it feeds an effect's deps), and one function rather than three
 * because the logout clear runs once for the whole app now — see
 * `ClearCacheOnLogout`.
 */
const clearPersistedStores = async () => {
  await Promise.all([
    clearChatPersistedCache(),
    clearFeedbackPersistedCache(),
    clearIngestPersistedCache(),
  ]);
};

/**
 * App adapter for the offline-read persistence seam (@acme/hooks ADR 0001). The app — not the
 * feature — owns auth: it passes the signed-in user's id as `scopeKey` to the
 * chat + feedback + ingest providers. The id is *server-resolved* (`getAuthState()` in the
 * `__root` `beforeLoad`) so it's present on the very first render, before each
 * feature builds its persister — a client-side session read would resolve too
 * late and the feature would attach none. `scopeKey` scopes each user's cache and
 * makes a different user or a new deploy discard the prior snapshot (buster =
 * appVersion + scopeKey). Signed out ⇒ `scopeKey` undefined ⇒ network-only,
 * exactly as before. Features stay auth-agnostic: the id arrives as a plain
 * string. Mirrors the Next.js app's adapter — same conceptual seam on a second
 * framework.
 *
 * These providers nest but no longer stack QueryClients — there is one, created
 * in `router.tsx` and mounted by the router's `Wrap` (ADR 0036) — so the nesting
 * is now just tRPC context, and their order carries no meaning.
 */
export function PersistedFeatureProviders({
  scopeKey,
  children,
}: {
  scopeKey?: string;
  children: ReactNode;
}) {
  return (
    <ChatTRPCProvider scopeKey={scopeKey}>
      <FeedbackTRPCProvider scopeKey={scopeKey}>
        <IngestTRPCProvider scopeKey={scopeKey}>
          <ClearCacheOnLogout isSignedIn={Boolean(scopeKey)} />
          {children}
        </IngestTRPCProvider>
      </FeedbackTRPCProvider>
    </ChatTRPCProvider>
  );
}

/**
 * Hands the app-owned auth transition to the substrate's
 * `useClearCacheOnLogout` (in `@acme/hooks`, framework- and auth-agnostic).
 *
 * Rendered **once**, not once per feature provider. The hook pairs
 * `queryClient.clear()` with the store clear, and with a single app-owned client
 * that `clear()` already empties every feature (ADR 0036) — three renders would
 * have wiped the same cache three times. So the store clear is composed to match
 * its scope: all three of this app's persisted stores, in one call.
 *
 * `isSignedIn` is derived from `scopeKey` rather than read from an auth hook,
 * which is not just a saved import: `scopeKey` *is* the server-resolved id these
 * providers are already keyed on, so the signal the hook watches and the scope
 * the cache is stored under can never disagree. A client-side auth hook would be
 * a second source of the same fact.
 */
function ClearCacheOnLogout({ isSignedIn }: { isSignedIn: boolean }) {
  useClearCacheOnLogout(isSignedIn, clearPersistedStores);
  return null;
}
