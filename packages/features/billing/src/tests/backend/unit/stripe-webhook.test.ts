/**
 * Stripe webhook handler tests.
 *
 * The webhook routing logic (allowedEvents filter + customer-id extraction) was
 * previously tangled inside a 594-line stripe.ts and only exercised end-to-end
 * through the app routes. It's now isolable: `resolveWebhookEvent` is pure and
 * `processEvent` takes an injectable sync fn, so both are unit-testable with no
 * live Stripe/Redis.
 */
import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import {
  allowedEvents,
  resolveWebhookEvent,
} from '../../../utils/stripe-webhook';

// Minimal Stripe.Event shape for routing tests — only the fields the handler
// reads. Cast is confined to the test builder, not production code.
function makeEvent(type: string, dataObject: unknown): Stripe.Event {
  return { type, data: { object: dataObject } } as unknown as Stripe.Event;
}

describe('resolveWebhookEvent', () => {
  it('ignores untracked event types', () => {
    const event = makeEvent('customer.created', { customer: 'cus_123' });
    expect(resolveWebhookEvent(event)).toEqual({ handled: false });
  });

  it('routes a tracked event to its customer id', () => {
    const type = 'customer.subscription.updated';
    expect(allowedEvents.has(type)).toBe(true);
    const event = makeEvent(type, { customer: 'cus_abc' });
    expect(resolveWebhookEvent(event)).toEqual({
      handled: true,
      customerId: 'cus_abc',
    });
  });

  it('throws when a tracked event carries a non-string customer id', () => {
    const event = makeEvent('invoice.paid', { customer: 12_345 });
    expect(() => resolveWebhookEvent(event)).toThrow(TypeError);
  });

  it('throws when a tracked event has no customer field', () => {
    const event = makeEvent('invoice.paid', {});
    expect(() => resolveWebhookEvent(event)).toThrow(TypeError);
  });
});
