'use client';

import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertCircle, CreditCard, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'react-toastify';

import { useGenericErrorHandler } from '@acme/hooks';
import { Button } from '@acme/ui';

import { useTRPC } from '../../trpc/react';

interface SubscriptionCancellationProps {
  subscriptionType?: string;
  className?: string;
  isCancelledAtPeriodEnd?: boolean;
  currentPeriodEnd?: number | null;
}

// Format the cancellation date
const formatCancellationDate = (timestamp: number | null) => {
  if (!timestamp) return 'the end of your billing period';
  return new Date(timestamp * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

export function SubscriptionCancellation({
  subscriptionType,
  className = '',
  isCancelledAtPeriodEnd = false,
  currentPeriodEnd = null,
}: SubscriptionCancellationProps) {
  const handleError = useGenericErrorHandler();

  const [redirectUrl, setRedirectUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (redirectUrl) {
      globalThis.location.href = redirectUrl;
    }
  }, [redirectUrl]);

  // Check if user has an active subscription (not Basic)
  const hasActiveSubscription =
    subscriptionType && subscriptionType !== 'Basic';
  const trpc = useTRPC();

  const createDashboardSession = useMutation(
    trpc.account.createDashboardSession.mutationOptions({
      onSuccess: (data) => {
        toast.success('Redirecting to Stripe dashboard...', {
          autoClose: 1000,
          closeButton: true,
          icon: () => <CreditCard className="h-4 w-4" />,
        });
        setRedirectUrl(data.billingPortalUrl);
      },
      onError: handleError,
    }),
  );

  const handleCancellation = () => {
    createDashboardSession.mutate();
  };

  // Named separately for clarity even though do same thing
  const handleReactivation = () => {
    createDashboardSession.mutate();
  };

  // Don't show the component if user doesn't have an active subscription
  if (!hasActiveSubscription) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className={`mt-12 ${className}`}
    >
      <div className="mx-auto max-w-md">
        {isCancelledAtPeriodEnd ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center dark:border-amber-700 dark:bg-amber-900/20">
            <div className="mb-3 flex items-center justify-center">
              <AlertCircle className="mr-2 h-5 w-5 text-amber-600 dark:text-amber-400" />
              <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Subscription Cancelled
              </h3>
            </div>
            <p className="mb-4 text-sm text-amber-700 dark:text-amber-300">
              Your subscription has been cancelled and will end on{' '}
              <span className="font-medium">
                {formatCancellationDate(currentPeriodEnd)}
              </span>
              . You can continue using all features until this date.
            </p>
            <div className="flex flex-col space-y-2 sm:flex-row sm:justify-center sm:space-y-0 sm:space-x-3">
              <Button
                variant="outline"
                size="sm"
                className="border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-900/40"
                onClick={handleReactivation}
                disabled={createDashboardSession.isPending}
              >
                {createDashboardSession.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reactivate Subscription
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-text-secondary/80 mb-2 text-xs">
              We&apos;re sorry to see you go.
            </p>
            <Button
              variant="link"
              className="text-text-secondary/60 hover:text-text-secondary h-auto p-0 text-xs underline"
              onClick={handleCancellation}
              disabled={createDashboardSession.isPending}
            >
              {createDashboardSession.isPending ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Processing...
                </>
              ) : (
                'Cancel Subscription'
              )}
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
