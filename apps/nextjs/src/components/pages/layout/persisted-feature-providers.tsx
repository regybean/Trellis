'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@acme/auth';
import { ChatTRPCReactProvider, clearChatPersistedCache } from '@acme/chat';
import {
  clearPersistedCache as clearFeedbackPersistedCache,
  FeedbackTRPCReactProvider,
} from '@acme/feedback';

/**
 * App adapter for the offline-read persistence seam (ADR 0025). The app — not the
 * feature — owns auth: it passes the signed-in user's id as `scopeKey` to the
 * chat + feedback providers. The id is *server-resolved* (`auth()` in the root
 * layout) so it's present on the very first render, before each feature's
 * QueryClient singleton is created — a client `useAuth()` would resolve too late
 * and the singleton would attach no persister. `scopeKey` scopes each user's
 * cache and makes a different user or a new deploy discard the prior snapshot
 * (buster = appVersion + scopeKey). Signed out ⇒ `scopeKey` undefined ⇒
 * network-only, exactly as before. Features stay auth-agnostic (no Clerk import):
 * the id arrives as a plain string.
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
        {children}
      </FeedbackTRPCReactProvider>
    </ChatTRPCReactProvider>
  );
}

/**
 * Wipes one mounted feature's caches when a signed-in user logs out on a shared
 * machine (userId → null): its persisted IndexedDB store *and* its in-memory
 * QueryClient (read from context, so it's the feature's own client — no feature
 * change needed). `buster` already blocks cross-account *reads*; this removes the
 * departing user's data outright. Rendered inside each feature provider; watching
 * the `@acme/auth` seam's transition is the framework-neutral logout hook —
 * Clerk's `UserButton` owns its own sign-out button, so there is no onClick to
 * attach.
 */
function ClearCacheOnLogout({
  clearStore,
}: {
  clearStore: () => Promise<void>;
}) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (userId) {
      wasSignedIn.current = true;
      return;
    }
    if (wasSignedIn.current) {
      wasSignedIn.current = false;
      queryClient.clear();
      void clearStore();
    }
  }, [userId, queryClient, clearStore]);

  return null;
}
