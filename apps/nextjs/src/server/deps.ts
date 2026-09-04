/**
 * Composition root — @acme/nextjs.
 *
 * Everything this app injects into a seam is constructed here, once, and every
 * entry point imports the result: the tRPC route seam (`src/server/trpc-route.ts`)
 * and the generation worker (`worker.ts`).
 *
 * Two independently constructed providers both typecheck — TypeScript checks
 * that a mount naming `entitlements` gets one (#264), not that the worker and
 * the route seam got the *same* one. Confining construction to this file is
 * what makes them the same value (ADR 0006), so a turn that charged the Credit
 * ledger refunds the same ledger.
 *
 * Built values only: no helpers, no re-exports. An ESLint override keeps the
 * factories out of every other file in this app.
 */

import { env as billingEnv, toPlanIds } from '@acme/billing/env';
import { createSubscriptionsEntitlements } from '@acme/subscriptions';

/**
 * The Stripe/Redis entitlements provider, closing over the plan ids billing's
 * own env resolves (@acme/env ADR 0001) — the product→tier mapping needs them, and the
 * platform no longer reads them from `process.env`.
 */
export const entitlements = createSubscriptionsEntitlements(
  toPlanIds(billingEnv),
);
