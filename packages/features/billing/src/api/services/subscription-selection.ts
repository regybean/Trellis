import type Stripe from 'stripe';

/**
 * Which of a customer's subscriptions is "the current one".
 *
 * A customer can legitimately hold several at once — most commonly right after
 * a tier change, since the grant cancels the predecessor before creating the
 * replacement, leaving one `canceled` and one `active`. Something has to choose
 * between them, and taking whichever the API listed first is not a choice: real
 * Stripe documents newest-first ordering, localstripe lists oldest-first, and
 * neither guarantee is something the caller should be leaning on.
 *
 * So the rule is explicit: **the subscription that best describes what the
 * customer has right now**, by status first and recency second.
 */

/**
 * Subscription statuses, best-describing first.
 *
 * Three bands, and the band boundaries are the load-bearing part — the order
 * within a band is a tiebreak, not a claim about entitlement:
 *
 * 1. `active` / `trialing` — entitled today. What the app should report.
 * 2. `past_due` / `unpaid` / `incomplete` / `paused` — still the customer's
 *    subscription, not yet entitling. Reported so the UI can say *why* access
 *    stopped (`getSubscriptionType` maps all of these to `Basic`) instead of
 *    claiming there is no subscription at all.
 * 3. `canceled` / `incomplete_expired` — over. Only chosen when nothing better
 *    exists, which keeps a fully-canceled customer reading back `canceled`
 *    rather than `none`.
 */
const STATUS_PRECEDENCE: readonly Stripe.Subscription.Status[] = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'paused',
  'canceled',
  'incomplete_expired',
];

// A status the SDK knows about but this list doesn't sorts last rather than
// first, so a future Stripe status can never outrank a genuinely active
// subscription just by being unrecognised.
const rank = (status: Stripe.Subscription.Status) => {
  const index = STATUS_PRECEDENCE.indexOf(status);
  return index === -1 ? STATUS_PRECEDENCE.length : index;
};

/**
 * The subset of a Stripe subscription the choice actually turns on. Narrower
 * than `Stripe.Subscription` so the ranking can be exercised with plain
 * objects, and generic so callers get their own full type back.
 */
interface RankableSubscription {
  status: Stripe.Subscription.Status;
  created: number;
}

/**
 * Pick the customer's current subscription, or `undefined` when the list is
 * empty. Does not mutate the list.
 *
 * Ordering: status precedence, then most recently created. When two
 * subscriptions tie on both there is nothing left to distinguish them, and the
 * earlier of the two wins — arbitrary, but the same every run.
 */
export function selectCurrentSubscription<T extends RankableSubscription>(
  subscriptions: readonly T[],
): T | undefined {
  return subscriptions.reduce<T | undefined>((best, candidate) => {
    if (!best) return candidate;

    const byStatus = rank(candidate.status) - rank(best.status);
    if (byStatus !== 0) return byStatus < 0 ? candidate : best;

    return candidate.created > best.created ? candidate : best;
  }, undefined);
}
