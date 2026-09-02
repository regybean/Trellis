'use client';

import { createFeatureClient } from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { env } from '../env';

// Notifications' client half, assembled from the shared factory (`@acme/hooks`).
// It is the simplest caller: the only link that matters is the `stream` SSE
// (`subscriptions: true`, `httpSubscriptionLink`); the plain `http` transport
// half exists so tests stay MSW-friendly and the link never throws while the SSE
// can't connect in jsdom (ADR 0018). No persister, no `scopeKey` — the server
// keys the stream by `ctx.session.user.id`. It is also subscription-only, so it
// has no queries for a `staleTime` to apply to and nothing it would have put on a
// `QueryClient` of its own (ADR 0036).
const client = createFeatureClient<AppRouter>({
  keyPrefix: 'notifications',
  nodeEnv: env.NODE_ENV,
  transport: 'http',
  subscriptions: true,
});

// One binding at a time, NOT `export const { … } = client` — see chat's note:
// a `'use client'` module's exports must be statically named or Next's
// client-reference manifest misses them and the provider resolves to undefined.
export const useTRPC = client.useTRPC;
export const NotificationsTRPCProvider = client.FeatureTRPCProvider;
