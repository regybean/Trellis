'use client';

import { createFeatureClient } from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { env } from '../env';
import { createQueryClient } from './query-client';

// Notifications' client half, assembled from the shared factory (`@acme/hooks`).
// It is the simplest caller: the only link that matters is the `stream` SSE
// (`subscriptions: true`, `httpSubscriptionLink`); the plain `http` transport
// half exists so tests stay MSW-friendly and the link never throws while the SSE
// can't connect in jsdom (ADR 0018). No persister, no `scopeKey` — the server
// keys the stream by `ctx.auth.userId`.
const client = createFeatureClient<AppRouter>({
  keyPrefix: 'notifications',
  nodeEnv: env.NODE_ENV,
  createQueryClient,
  transport: 'http',
  subscriptions: true,
});

export const { useTRPC } = client;
export const NotificationsTRPCProvider = client.TRPCReactProvider;
