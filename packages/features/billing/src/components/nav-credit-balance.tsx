'use client';

import { Skeleton } from '@acme/ui';

import { useSubscriptionDetails } from '../hooks/use-subscription-details';

/**
 * The viewer's Plan and Credit balance, compact enough to sit inside a
 * signed-in menu.
 *
 * This package owns the display; the app owns where it goes. The Tier label,
 * the number format and the two absent states below are billing's domain
 * language, and formatting them per app is how two shells end up disagreeing
 * about the same balance
 * ([ADR 0002](../../docs/adr/0002-credit-balance-display-belongs-to-billing.md)).
 *
 * Absent states differ on purpose. Pending renders a skeleton, because the menu
 * is already open and a row that appears late shifts what the user is reaching
 * for. A failed read renders nothing at all: the detailed view behind
 * `SubscriptionDetailsModal` already has an "Unable to Load Details" path, and a
 * second error message in the menu itself would report the same failure twice.
 */
export function NavCreditBalance() {
  const { subscriptionData, creditUsageData, isLoading, isError } =
    useSubscriptionDetails();

  if (isLoading) {
    return (
      <div className="space-y-1.5 px-2 py-1.5">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-1.5 w-full" />
      </div>
    );
  }

  if (isError || !subscriptionData || !creditUsageData) return null;

  const { remaining, limit } = creditUsageData;

  // `credits.refund` is an uncapped `incrBy`, so a refunded Generation can leave
  // `remaining` above `limit` and the server's `usagePercentage` negative. The
  // bar is clamped because a negative width is a rendering bug; `remaining` is
  // printed raw because 251 of 250 credits is simply what the account holds.
  const usedPercentage = Math.min(
    100,
    Math.max(0, creditUsageData.usagePercentage),
  );

  return (
    <div className="space-y-1.5 px-2 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-foreground text-sm font-medium">
          {subscriptionData.subscription} plan
        </span>
        <span className="text-muted-foreground text-xs">
          {remaining.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div
        className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={usedPercentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Credits used"
      >
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${usedPercentage}%` }}
        />
      </div>
      <span className="text-muted-foreground block text-xs">
        credits remaining
      </span>
    </div>
  );
}
