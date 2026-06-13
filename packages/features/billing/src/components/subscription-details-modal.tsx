'use client';

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle,
  Info,
  Zap,
} from 'lucide-react';

import {
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@acme/ui';

import { SubscriptionCancellation } from './stripe/stripe-cancellation';

// Exporting interfaces so tests (and other consumers) can share a single source of truth
// for the shape of subscription & token usage data rather than duplicating ad-hoc types.
export interface SubscriptionDetails {
  subscription: string;
  currentPeriodEnd: number | null;
  currentPeriodStart: number | null;
  cancelAtPeriodEnd: boolean;
  status: string; // Stripe status union not enforced here; tests/runtime can use specific literals
}

interface CreditUsage {
  remaining: number;
  limit: number;
  resetAt: number;
  usagePercentage: number;
}

interface SubscriptionDetailsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionData: SubscriptionDetails | undefined;
  creditUsageData?: CreditUsage;
}

// Format dates for display
const formatDate = (timestamp: number | null) => {
  if (!timestamp) return 'N/A';
  return new Date(timestamp * 1000).toLocaleDateString('en-gb');
};

const getStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case 'active': {
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    }
    case 'none': {
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
    }
    case 'canceled':
    case 'cancelled': {
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
    }
    case 'past_due': {
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
    }
    default: {
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
    }
  }
};

const getPlanColor = (plan: string) => {
  switch (plan.toLowerCase()) {
    case 'basic': {
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
    }
    case 'standard': {
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
    }
    case 'pro': {
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
    }
    default: {
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
    }
  }
};

const getProgressBarColor = (usagePercentage: number) => {
  if (usagePercentage >= 90) return 'bg-red-600';
  if (usagePercentage >= 70) return 'bg-yellow-600';
  return 'bg-green-600';
};

export function SubscriptionDetailsModal({
  isOpen,
  onOpenChange,
  subscriptionData,
  creditUsageData,
}: SubscriptionDetailsModalProps) {
  if (!subscriptionData) {
    return (
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Unable to Load Details
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 text-center">
            <p className="text-muted-foreground">
              Unable to load subscription details. Please try again later.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const {
    subscription,
    currentPeriodEnd,
    currentPeriodStart,
    cancelAtPeriodEnd,
    status,
  } = subscriptionData;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="text-primary h-5 w-5" />
            Subscription Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 p-1">
          {/* Plan and Status */}
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div>
                <p className="text-muted-foreground text-sm font-medium">
                  Plan
                </p>
                <Badge
                  className={getPlanColor(subscription)}
                  variant="secondary"
                >
                  {subscription}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground text-sm font-medium">
                  Status
                </p>
                <Badge className={getStatusColor(status)} variant="secondary">
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Badge>
              </div>
            </div>
          </div>

          {/* Billing Period Information */}
          {(currentPeriodStart ?? currentPeriodEnd) && (
            <div className="space-y-3">
              <h4 className="text-muted-foreground text-sm font-medium">
                Billing Period
              </h4>

              {currentPeriodStart && (
                <div className="flex items-center gap-3">
                  <CalendarDays className="text-muted-foreground h-4 w-4" />
                  <div>
                    <p className="text-sm font-medium">Current Period Start</p>
                    <p className="text-muted-foreground text-sm">
                      {formatDate(currentPeriodStart)}
                    </p>
                  </div>
                </div>
              )}

              {currentPeriodEnd && (
                <div className="flex items-center gap-3">
                  <CalendarDays className="text-muted-foreground h-4 w-4" />
                  <div>
                    <p className="text-sm font-medium">
                      {cancelAtPeriodEnd
                        ? 'Cancellation Date'
                        : 'Next Renewal Date'}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {formatDate(currentPeriodEnd)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Credit Usage */}
          {creditUsageData && (
            <div className="space-y-3" data-testid="credit-usage-section">
              <h4 className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
                <Zap className="h-4 w-4" />
                Credit Usage
              </h4>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Used</span>
                  <span className="font-medium">
                    {creditUsageData.limit - creditUsageData.remaining} /{' '}
                    {creditUsageData.limit}
                  </span>
                </div>

                {/* Custom Progress Bar */}
                <div className="h-2.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-300 ease-in-out ${getProgressBarColor(creditUsageData.usagePercentage)}`}
                    style={{ width: `${creditUsageData.usagePercentage}%` }}
                    data-testid="credit-usage-progress"
                  ></div>
                </div>

                <div className="text-muted-foreground flex items-center justify-between text-xs">
                  <span>{creditUsageData.remaining} credits remaining</span>
                  <span>Resets {formatDate(creditUsageData.resetAt)}</span>
                </div>

                {creditUsageData.remaining === 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-900/20">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
                    <div>
                      <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                        No Credits Remaining
                      </p>
                      <p className="text-sm text-orange-700 dark:text-orange-300">
                        Your credits will be refreshed on{' '}
                        {formatDate(creditUsageData.resetAt)}.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Status Messages */}
          <div className="space-y-2">
            {!cancelAtPeriodEnd && subscription !== 'Basic' && (
              <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    Auto-Renewal Active
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    Your subscription will automatically renew.
                  </p>
                </div>
              </div>
            )}

            {subscription === 'Basic' && (
              <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    Free Plan
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    You&apos;re currently on the free Basic plan.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Subscription Management Actions */}
          <SubscriptionCancellation
            subscriptionType={subscription}
            isCancelledAtPeriodEnd={cancelAtPeriodEnd}
            currentPeriodEnd={currentPeriodEnd}
            className="mt-4"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
