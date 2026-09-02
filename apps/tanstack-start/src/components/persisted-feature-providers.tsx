import type { ReactNode } from 'react';

import { ChatTRPCReactProvider, clearChatPersistedCache } from '@acme/chat';
import {
  clearPersistedCache as clearFeedbackPersistedCache,
  FeedbackTRPCReactProvider,
} from '@acme/feedback';
import { useClearCacheOnLogout } from '@acme/hooks';
import {
  clearIngestPersistedCache,
  IngestTRPCReactProvider,
} from '@acme/ingest';

/**
 * App adapter for the offline-read persistence seam (ADR 0025). The app — not the
 * feature — owns auth: it passes the signed-in user's id as `scopeKey` to the
 * chat + feedback + ingest providers. The id is *server-resolved* (`getAuthState()` in the
 * `__root` `beforeLoad`) so it's present on the very first render, before each
 * feature's QueryClient singleton is created — a client-side session read would
 * resolve too late and the singleton would attach no persister. `scopeKey` scopes
 * each user's cache and makes a different user or a new deploy discard the prior
 * snapshot (buster = appVersion + scopeKey). Signed out ⇒ `scopeKey` undefined ⇒
 * network-only, exactly as before. Features stay auth-agnostic: the id arrives as
 * a plain string. Mirrors the Next.js app's adapter — same conceptual seam on a
 * second framework.
 */
export function PersistedFeatureProviders({
  scopeKey,
  children,
}: {
  scopeKey?: string;
  children: ReactNode;
}) {
  return (
    <ChatTRPCReactProvider scopeKey={scopeKey}>
      <ClearCacheOnLogout
        isSignedIn={Boolean(scopeKey)}
        clearStore={clearChatPersistedCache}
      />
      <FeedbackTRPCReactProvider scopeKey={scopeKey}>
        <ClearCacheOnLogout
          isSignedIn={Boolean(scopeKey)}
          clearStore={clearFeedbackPersistedCache}
        />
        <IngestTRPCReactProvider scopeKey={scopeKey}>
          <ClearCacheOnLogout
            isSignedIn={Boolean(scopeKey)}
            clearStore={clearIngestPersistedCache}
          />
          {children}
        </IngestTRPCReactProvider>
      </FeedbackTRPCReactProvider>
    </ChatTRPCReactProvider>
  );
}

/**
 * Hands the app-owned auth transition to the substrate's
 * `useClearCacheOnLogout` (in `@acme/hooks`, framework- and auth-agnostic).
 * Rendered inside each feature provider so the hook clears that feature's own
 * QueryClient (from context) plus its persisted store on logout.
 *
 * `isSignedIn` is derived from `scopeKey` rather than read from an auth hook,
 * which is not just a saved import: `scopeKey` *is* the server-resolved id these
 * providers are already keyed on, so the signal the hook watches and the scope
 * the cache is stored under can never disagree. Under Clerk this read
 * `useAuth()` — a second, client-side source of the same fact.
 */
function ClearCacheOnLogout({
  isSignedIn,
  clearStore,
}: {
  isSignedIn: boolean;
  clearStore: () => Promise<void>;
}) {
  useClearCacheOnLogout(isSignedIn, clearStore);
  return null;
}
