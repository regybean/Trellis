'use client';

import { createFeatureClient } from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { env } from '../env';

// Billing's client half. It was the last hand-rolled feature provider — a
// verbatim copy of the create-t3-app scaffold — and folds into the shared factory
// (`@acme/hooks`) here because it had to lose its own `QueryClient` regardless
// (ADR 0036). Two `splitLink` branches went with it, both dead: a subscription
// split for a router (`account`) that declares no subscription, and a
// non-JSON-serialisable split for a feature that uploads nothing. What is left is
// billing's real variation: its router type, endpoint (`/api/trpc/billing`), and
// the batch-stream transport.
//
// No persister. Credits and Subscription state are the queries @acme/hooks ADR 0001 names as
// the ones never to persist — they are the account's live balance, and a restored
// snapshot of a number the user is watching change is worse than a spinner.
const client = createFeatureClient<AppRouter>({
  keyPrefix: 'billing',
  nodeEnv: env.NODE_ENV,
  transport: 'batch-stream',
});

// One binding at a time, NOT `export const { … } = client` — see chat's note:
// a `'use client'` module's exports must be statically named or Next's
// client-reference manifest misses them and the provider resolves to undefined.
export const TRPCProvider = client.FeatureTRPCProvider;
export const useTRPC = client.useTRPC;
