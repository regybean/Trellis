/**
 * The rule for "which of these is the customer's current subscription".
 *
 * Pure ranking logic, so it is asserted here rather than through a Stripe
 * server: the cases that matter are combinations of status and age, and
 * enumerating them against a real server would mean manufacturing dunning and
 * expiry states localstripe cannot reach. The integration side — that
 * `syncStripeDataToKV` actually routes its list through this — is covered in
 * `tests/backend/integration/service/stripe-sync.test.ts`.
 */

import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { selectCurrentSubscription } from '../../../api/services/subscription-selection';

const sub = (
  id: string,
  status: Stripe.Subscription.Status,
  created: number,
) => ({ id, status, created });

describe('selectCurrentSubscription', () => {
  it('returns undefined for a customer with no subscriptions', () => {
    expect(selectCurrentSubscription([])).toBeUndefined();
  });

  it('returns the only subscription whatever its status', () => {
    const only = sub('sub_a', 'canceled', 100);

    expect(selectCurrentSubscription([only])).toBe(only);
  });

  // The bug this rule exists for: a re-grant leaves a canceled predecessor
  // beside the new active subscription. Both list orders must pick the active
  // one — real Stripe documents newest-first, localstripe lists oldest-first.
  it('prefers an active subscription over a canceled one, in either list order', () => {
    const canceled = sub('sub_old', 'canceled', 100);
    const active = sub('sub_new', 'active', 200);

    expect(selectCurrentSubscription([canceled, active])).toBe(active);
    expect(selectCurrentSubscription([active, canceled])).toBe(active);
  });

  // Status outranks age, so an older live subscription beats a newer dead one.
  // Otherwise a customer who was re-granted and then had the new subscription
  // expire unpaid would read back off the expired one.
  it('prefers a live subscription over a newer terminal one', () => {
    const active = sub('sub_live', 'active', 100);
    const expired = sub('sub_dead', 'incomplete_expired', 999);

    expect(selectCurrentSubscription([expired, active])).toBe(active);
  });

  it.each([
    ['trialing', 'past_due'],
    ['active', 'trialing'],
    ['past_due', 'unpaid'],
    ['unpaid', 'incomplete'],
    ['incomplete', 'paused'],
    ['paused', 'canceled'],
    ['canceled', 'incomplete_expired'],
  ] as const)('ranks %s above %s', (better, worse) => {
    const winner = sub('sub_winner', better, 100);
    const loser = sub('sub_loser', worse, 100);

    expect(selectCurrentSubscription([loser, winner])).toBe(winner);
  });

  it('breaks a same-status tie by taking the newest', () => {
    const older = sub('sub_older', 'active', 100);
    const newer = sub('sub_newer', 'active', 200);

    expect(selectCurrentSubscription([older, newer])).toBe(newer);
    expect(selectCurrentSubscription([newer, older])).toBe(newer);
  });

  // Nothing left to rank on: same status, same creation second. The choice is
  // arbitrary but must not vary run to run, so it settles on list order.
  it('is stable when status and creation time are identical', () => {
    const first = sub('sub_first', 'active', 100);
    const second = sub('sub_second', 'active', 100);

    expect(selectCurrentSubscription([first, second])).toBe(first);
    expect(selectCurrentSubscription([second, first])).toBe(second);
  });

  it('does not mutate the list it was given', () => {
    const canceled = sub('sub_old', 'canceled', 100);
    const active = sub('sub_new', 'active', 200);
    const list = [canceled, active];

    selectCurrentSubscription(list);

    expect(list).toEqual([canceled, active]);
  });
});
