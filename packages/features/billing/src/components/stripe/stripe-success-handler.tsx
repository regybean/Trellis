import { redirect } from 'next/navigation';
import { Database, RefreshCw } from 'lucide-react';

import { getStripeCustomerId } from '@acme/subscriptions';

import { syncStripeDataToKV } from '../../utils/stripe';

/**
 * Post-checkout RSC: syncs the buyer's Stripe data into Redis before the app
 * routes them on. Blessed Next-coupled adapter — exported only via
 * `@acme/billing/server-next` (the app-facing Next surface), never the neutral
 * seam, because of the `next/navigation` redirect. See ADR 0003.
 *
 * The viewer's id arrives as a prop rather than being resolved here: auth
 * resolution is app-owned (ADR 0003), and the two full apps are on different
 * providers mid-migration (#218). A signed-out caller is the app's redirect to
 * make, so `userId` is required.
 */
export async function StripeSuccessHandler({ userId }: { userId: string }) {
  // Get the stripe customer ID from Redis
  const stripeCustomerId = await getStripeCustomerId(userId);

  if (!stripeCustomerId) {
    redirect('/');
  }

  // Sync the latest Stripe data to Redis
  try {
    await syncStripeDataToKV(stripeCustomerId);
  } catch {
    // Error syncing Stripe data
    // Continue anyway - we don't want to block the user
  }

  // Show processing message briefly before redirecting
  return (
    <div className="flex flex-col items-center space-y-6">
      <div className="relative">
        <Database className="h-16 w-16 text-blue-600" />
        <RefreshCw className="absolute -top-2 -right-2 h-6 w-6 animate-spin text-indigo-600" />
      </div>
      <div className="text-center">
        <h2 className="mb-2 text-2xl font-bold text-gray-900">
          Processing Your Data
        </h2>
        <p className="mb-4 text-gray-600">
          We&apos;re syncing your subscription data and setting up your account.
        </p>
        <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
          <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500"></div>
          <div className="animation-delay-150 h-2 w-2 animate-pulse rounded-full bg-blue-500"></div>
          <div className="animation-delay-300 h-2 w-2 animate-pulse rounded-full bg-blue-500"></div>
          <span className="ml-2">Almost ready...</span>
        </div>
      </div>
    </div>
  );
}
