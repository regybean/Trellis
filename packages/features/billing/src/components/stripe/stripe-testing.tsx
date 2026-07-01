'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { CreditCard, Loader2, TestTube } from 'lucide-react';
import { toast } from 'react-toastify';

import { useGenericErrorHandler } from '@acme/hooks';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@acme/ui';

import { env } from '../../env';
import { useTRPC } from '../../trpc/react';
import {
  BillingErrorCode,
  toBillingErrorCode,
} from '../../utils/stripe-errors';

const TOAST_OPTS = { autoClose: 4000, closeButton: true } as const;

// Map each typed billing error code to its user-facing toast. Exhaustive over
// BillingErrorCode via Record, so adding a code is a compile error until it's
// handled here — the coupling is now typed, not string-matched.
const BILLING_ERROR_TOASTS: Record<BillingErrorCode, string> = {
  [BillingErrorCode.NoDefaultPrice]:
    '❌ Product configuration error: Missing default price',
  [BillingErrorCode.ActiveSubscription]:
    '⚠️ You already have an active subscription',
  [BillingErrorCode.CustomerManagementFailed]:
    '❌ Customer account error: Please try again',
  [BillingErrorCode.NoEmail]:
    '❌ Account setup required: Please add an email address',
  [BillingErrorCode.NoCustomer]: '❌ No existing Stripe customer found',
  [BillingErrorCode.StripeUnavailable]:
    '❌ Stripe service error: Please try again later',
  [BillingErrorCode.DevOnly]: '❌ This action is only available in local dev',
  [BillingErrorCode.MissingPlan]:
    '❌ Billing plan not configured: run the localstripe seed',
};

export function StripeTesting() {
  const [activeTest, setActiveTest] = useState<null | 'standard' | 'pro'>(null);

  const handleError = useGenericErrorHandler();

  // Custom Stripe error handler. Branches on the TYPED billing error code
  // carried in the tRPC error message (see stripe-errors.ts) — no substring
  // matching against prose, so rewording a server message can't silently break
  // a UI branch.
  const handleStripeError = (error: unknown) => {
    if (error instanceof TRPCClientError) {
      const code = toBillingErrorCode(error);
      if (code) {
        toast.error(BILLING_ERROR_TOASTS[code], TOAST_OPTS);
        return;
      }
      // Fall back to the generic tRPC error handler (rate-limit, etc.)
      handleError(error);
      return;
    }

    // Non-tRPC errors: let the generic handler show its default toast.
    handleError();
  };
  const trpc = useTRPC();
  const createCheckoutSession = useMutation(
    trpc.account.createCheckoutSession.mutationOptions({
      onSuccess: (data) => {
        if (data.checkoutUrl) {
          toast.success('Redirecting to Stripe checkout...', {
            autoClose: 1000,
            closeButton: true,
            icon: () => <CreditCard className="h-4 w-4" />,
          });
          globalThis.location.href = data.checkoutUrl;
        } else {
          toast.error('Failed to create checkout session');
        }
      },
      onError: (error) => {
        handleStripeError(error);
      },
    }),
  );

  // tRPC test feature queries (disabled by default, manual refetch)
  const standardFeature = useQuery(
    trpc.account.standardFeature.queryOptions(undefined, {
      enabled: false,
      retry: false,
    }),
  );
  const proFeature = useQuery(
    trpc.account.proFeature.queryOptions(undefined, {
      enabled: false,
      retry: false,
    }),
  );

  const runTest = async (which: 'standard' | 'pro') => {
    setActiveTest(which);
    try {
      const doRefetch = async () => {
        switch (which) {
          case 'standard': {
            return standardFeature.refetch();
          }
          case 'pro': {
            return proFeature.refetch();
          }
        }
      };
      const { data, error } = await doRefetch();
      if (error) {
        handleStripeError(error);
      } else if (data) {
        toast.success(data.message, { autoClose: 2500 });
      }
    } finally {
      setActiveTest(null);
    }
  };

  return (
    <Card className="border-border shadow-xs">
      <CardHeader>
        <CardTitle className="text-foreground flex items-center">
          <TestTube className="text-accent-foreground mr-2 h-5 w-5" />
          Stripe Testing
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Test Stripe integration and subscription feature access
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Demo Purchase Section */}
        <div className="space-y-4">
          <h4 className="text-foreground font-medium">Demo Purchase</h4>
          <div className="border-primary bg-secondary/50 rounded-lg border border-dashed p-4">
            <p className="text-muted-foreground mb-4 text-sm">
              Test Stripe checkout session creation with a demo product.
            </p>
            <Button
              onClick={() =>
                createCheckoutSession.mutate({
                  productId: env.NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID,
                })
              }
              className="bg-primary text-on-primary hover:bg-primary/90"
              disabled={createCheckoutSession.isPending}
            >
              {createCheckoutSession.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Checkout...
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Test Standard Plan
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Feature Testing Section */}
        <div className="space-y-4">
          <h4 className="text-foreground font-medium">
            Subscription Feature Testing
          </h4>
          <div className="border-primary bg-secondary/50 rounded-lg border border-dashed p-4">
            <p className="text-muted-foreground mb-4 text-sm">
              Test protected subscription feature endpoints via tRPC.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => runTest('standard')}
                disabled={activeTest !== null}
                className="flex-1"
              >
                {activeTest === 'standard' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>Standard Feature</>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => runTest('pro')}
                disabled={activeTest !== null}
                className="flex-1"
              >
                {activeTest === 'pro' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>Pro Feature</>
                )}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
