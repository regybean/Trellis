import type Stripe from 'stripe';

import { syncStripeDataToKV } from './stripe-sync';

// Events I Track - for webhook processing
export const allowedEvents = new Set<Stripe.Event.Type>([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'invoice.upcoming',
  'invoice.marked_uncollectible',
  'invoice.payment_succeeded',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
]);

/**
 * The KV-sync dependency the webhook processor needs. Extracted as a seam so
 * `processEvent` is unit-testable without a live Stripe/Redis: the tests pass a
 * spy, production uses the real {@link syncStripeDataToKV}.
 */
type SyncFn = (customerId: string) => Promise<unknown>;

/**
 * Decide whether a webhook event is one we act on, and if so which customer it
 * targets. Pure — no I/O — so the routing logic (allowedEvents filter + the
 * customer-id shape assertion) is trivially testable in isolation.
 *
 * Returns `{ handled: false }` for untracked events, or the customerId to sync.
 * Throws `TypeError` if a tracked event carries a non-string customer id (our
 * assumption is wrong and we want to know).
 */
export function resolveWebhookEvent(
  event: Stripe.Event,
): { handled: false } | { handled: true; customerId: string } {
  // Skip processing if the event isn't one I'm tracking.
  if (!allowedEvents.has(event.type)) return { handled: false };

  // All the events I track have a customerId. TypeScript can't know the shape
  // of the untyped event payload, so we assert it at runtime.
  const dataObject: unknown = event.data.object;
  const customerId =
    typeof dataObject === 'object' &&
    dataObject !== null &&
    'customer' in dataObject
      ? dataObject.customer
      : undefined;

  if (typeof customerId !== 'string') {
    throw new TypeError(
      `[STRIPE HOOK] ID isn't string.\nEvent type: ${event.type}`,
    );
  }

  return { handled: true, customerId };
}

/**
 * Process a Stripe webhook event and sync the affected customer's data to the
 * KV store. `sync` is injectable for testing; defaults to the real sync.
 */
export async function processEvent(
  event: Stripe.Event,
  sync: SyncFn = syncStripeDataToKV,
): Promise<void> {
  const resolved = resolveWebhookEvent(event);
  if (!resolved.handled) return;
  await sync(resolved.customerId);
}
