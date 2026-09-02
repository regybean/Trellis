'use client';

import type { ReactNode } from 'react';

import { ChatTRPCReactProvider, clearChatPersistedCache } from '@acme/chat';
import {
  clearPersistedCache as clearFeedbackPersistedCache,
  FeedbackTRPCReactProvider,
} from '@acme/feedback';
import { useAuthStatus, useClearCacheOnLogout } from '@acme/hooks';
import {
  clearIngestPersistedCache,
  IngestTRPCReactProvider,
} from '@acme/ingest';

/**
 * App adapter for the offline-read persistence seam (ADR 0025). The app — not the
 * feature — owns auth: it passes the signed-in user's id as `scopeKey` to the
 * chat + feedback + ingest providers. The id is *server-resolved* (`auth.api.getSession`
 * in the root layout) so it's present on the very first render, before each
 * feature's QueryClient singleton is created — a client-side session read would
 * resolve too late and the singleton would attach no persister. `scopeKey` scopes
 * each user's cache and makes a different user or a new deploy discard the prior
 * snapshot (buster = appVersion + scopeKey). Signed out ⇒ `scopeKey` undefined ⇒
 * network-only, exactly as before. Features stay auth-agnostic (no auth-provider
 * import): the id arrives as a plain string.
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
      <ClearCacheOnLogout clearStore={clearChatPersistedCache} />
      <FeedbackTRPCReactProvider scopeKey={scopeKey}>
        <ClearCacheOnLogout clearStore={clearFeedbackPersistedCache} />
        <IngestTRPCReactProvider scopeKey={scopeKey}>
          <ClearCacheOnLogout clearStore={clearIngestPersistedCache} />
          {children}
        </IngestTRPCReactProvider>
      </FeedbackTRPCReactProvider>
    </ChatTRPCReactProvider>
  );
}

/**
 * Reads the app-owned auth transition and hands it to the substrate's
 * `useClearCacheOnLogout` (in `@acme/hooks`, framework- and auth-agnostic).
 * Rendered inside each feature provider so the hook clears that feature's own
 * QueryClient (from context) plus its persisted store on logout.
 */
function ClearCacheOnLogout({
  clearStore,
}: {
  clearStore: () => Promise<void>;
}) {
  const { isSignedIn } = useAuthStatus();
  useClearCacheOnLogout(isSignedIn, clearStore);
  return null;
}
