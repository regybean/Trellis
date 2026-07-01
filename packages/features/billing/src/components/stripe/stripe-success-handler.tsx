import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { Database, RefreshCw } from 'lucide-react';

import { getStripeCustomerId } from '@acme/subscriptions';

import { syncStripeDataToKV } from '../../utils/stripe';

export async function StripeSuccessHandler() {
  // Get the authenticated user
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

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
