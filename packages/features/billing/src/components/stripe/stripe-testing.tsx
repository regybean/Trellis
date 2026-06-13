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

export function StripeTesting() {
  const [activeTest, setActiveTest] = useState<null | 'standard' | 'pro'>(null);

  const handleError = useGenericErrorHandler();

  // Custom Stripe error handler that handles specific checkout errors
  const handleStripeError = (error: unknown) => {
    // Check if it's a TRPC error with specific Stripe-related messages
    if (error instanceof TRPCClientError) {
      const errorMessage = error.message.toLowerCase();

      // Handle specific Stripe checkout errors defined in stripe-utils
      if (errorMessage.includes('product does not have a default price')) {
        toast.error('❌ Product configuration error: Missing default price', {
          autoClose: 4000,
          closeButton: true,
        });
        return;
      }

      if (
        errorMessage.includes('customer already has an active subscription')
      ) {
        toast.error('⚠️ You already have an active subscription', {
          autoClose: 4000,
          closeButton: true,
        });
        return;
      }

      if (errorMessage.includes('customer management failed')) {
        toast.error('❌ Customer account error: Please try again', {
          autoClose: 4000,
          closeButton: true,
        });
        return;
      }

      if (errorMessage.includes('user does not have a primary email address')) {
        toast.error('❌ Account setup required: Please add an email address', {
          autoClose: 4000,
          closeButton: true,
        });
        return;
      }

      // Handle general internal server errors from Stripe operations
      if (
        errorMessage.includes('internal server error') &&
        (errorMessage.includes('stripe') ||
          (error.data &&
            typeof error.data === 'object' &&
            'code' in error.data &&
            (error.data as { code: string }).code === 'INTERNAL_SERVER_ERROR'))
      ) {
        toast.error('❌ Stripe service error: Please try again later', {
          autoClose: 4000,
          closeButton: true,
        });
        return;
      }
    }

    // Fall back to generic error handler for all other errors
    handleError(error as Parameters<typeof handleError>[0]);
  };
  const trpc = useTRPC();
  const createCheckoutSession = useMutation(
    trpc.account.createCheckoutSession.mutationOptions({
      onSuccess: (data) => {
        console.log(`data:`, data);
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
        <CardTitle className="text-text flex items-center">
          <TestTube className="text-text-accent mr-2 h-5 w-5" />
          Stripe Testing
        </CardTitle>
        <CardDescription className="text-text-secondary">
          Test Stripe integration and subscription feature access
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Demo Purchase Section */}
        <div className="space-y-4">
          <h4 className="text-text font-medium">Demo Purchase</h4>
          <div className="border-background-primary bg-background-secondary/50 rounded-lg border border-dashed p-4">
            <p className="text-text-secondary mb-4 text-sm">
              Test Stripe checkout session creation with a demo product.
            </p>
            <Button
              onClick={() =>
                createCheckoutSession.mutate({
                  productId: env.NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID,
                })
              }
              className="bg-background-primary text-on-primary hover:bg-button-primary-hover"
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
          <h4 className="text-text font-medium">
            Subscription Feature Testing
          </h4>
          <div className="border-background-primary bg-background-secondary/50 rounded-lg border border-dashed p-4">
            <p className="text-text-secondary mb-4 text-sm">
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
