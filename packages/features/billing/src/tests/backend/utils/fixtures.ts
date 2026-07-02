/**
 * Test Fixtures
 *
 * Factory functions for creating test data. These help create consistent
 * test data with sensible defaults that can be overridden as needed.
 */

import type { Stripe } from 'stripe';

import { nsKey, redis } from '@acme/redis';
import { setStripeCustomerId } from '@acme/subscriptions';

import type { SubscriptionData } from '../../../components/admin/subscription-details-display.tsx';

type SubscriptionStatus = Stripe.Subscription.Status | 'none';
type SubscriptionTier = 'Basic' | 'Standard' | 'Pro';

/**
 * Generate a random UUID (v4-like format)
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Create a test user ID in Clerk format
 */
export function createTestUserId(suffix?: string): string {
  return `user_test_${suffix ?? generateId().slice(0, 8)}`;
}

/**
 * Create a test Stripe customer ID
 */
export function createTestCustomerId(): string {
  return `cus_test_${generateId().slice(0, 8)}`;
}

/**
 * Create a test subscription ID
 */
export function createTestSubscriptionId(): string {
  return `sub_test_${generateId().slice(0, 8)}`;
}

/**
 * Create a test product ID
 */
export function createTestProductId(): string {
  return `prod_test_${generateId().slice(0, 8)}`;
}

/**
 * Options for creating a test subscription
 */
export interface CreateTestSubscriptionOptions {
  userId: string;
  status?: SubscriptionStatus;
  product?: string;
  tier?: SubscriptionTier;
}

/**
 * Create a subscription in Redis for testing
 */
export async function createTestSubscription(
  opts: CreateTestSubscriptionOptions,
): Promise<SubscriptionData> {
  const subscription: SubscriptionData = {
    subscription: {
      subscriptionId:
        opts.status === 'none' ? null : createTestSubscriptionId(),
      product: opts.product ?? null,
      status: opts.status ?? 'none',
      priceId: opts.status === 'none' ? null : 'price_test_12345',
      currentPeriodStart: Math.floor(Date.now() / 1000),
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 86_400 * 30,
      cancelAtPeriodEnd: false,
      paymentMethod:
        opts.status === 'none'
          ? null
          : {
              brand: 'visa',
              last4: '4242',
            },
    },
  };

  // Store in Redis
  const key = nsKey('subscription', opts.userId);
  await redis.set(key, JSON.stringify(subscription));

  return subscription;
}

/**
 * Set up Redis credits for a test user
 */
export async function setupTestCredits(
  userId: string,
  tier: 'Basic' | 'Standard' | 'Pro' = 'Basic',
  remaining = 100,
): Promise<void> {
  const key = nsKey('credits', userId, tier);
  await redis.set(key, remaining.toString());
}

/**
 * Get current credit count for a test user
 */
export async function getTestCredits(
  userId: string,
  tier: 'Basic' | 'Standard' | 'Pro' = 'Basic',
): Promise<number> {
  const key = nsKey('credits', userId, tier);
  const value = await redis.get(key);
  return value ? Number(value) : 0;
}

/**
 * Set up a Stripe customer mapping in Redis
 */
export async function setupTestStripeCustomer(
  userId: string,
  customerId?: string,
): Promise<string> {
  const custId = customerId ?? createTestCustomerId();
  await setStripeCustomerId(userId, custId);
  return custId;
}
