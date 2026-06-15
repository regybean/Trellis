'use client';

import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Check, CreditCard, Loader2, Star, Users, X } from 'lucide-react';
import { toast } from 'react-toastify';

import { useAuth } from '@acme/auth';
import { useGenericErrorHandler } from '@acme/hooks';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@acme/ui';

import {
  getButtonState,
  getTierColors,
  pricingPlans,
} from '../data/pricing-data';
import { env } from '../env';
import { useTRPC } from '../trpc/react';
import { ButtonSkeleton } from './pricing-components';

// In dev we run against localstripe, which has no Checkout Sessions API — the
// pricing CTAs can't create a checkout. Tiers are granted from the admin page
// (account.setUserTier) instead. See docs/adr/0003.
const isDev = env.NODE_ENV === 'development';

export function PricingPage() {
  const handleError = useGenericErrorHandler();

  // Check authentication status with Clerk
  const { isSignedIn, isLoaded } = useAuth();
  const trpc = useTRPC();

  // Get current user's subscription details - only if signed in and Clerk has loaded
  const subscription = useQuery(
    trpc.account.getSubscriptionDetails.queryOptions(undefined, {
      enabled: isLoaded && isSignedIn,
    }),
  );

  // Track which plan is currently processing
  const [processingPlanId, setProcessingPlanId] = React.useState<string | null>(
    null,
  );

  const [redirectUrl, setRedirectUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (redirectUrl) {
      globalThis.location.href = redirectUrl;
    }
  }, [redirectUrl]);
  const createCheckoutSession = useMutation(
    trpc.account.createCheckoutSession.mutationOptions({
      onSuccess: (data) => {
        if (data.checkoutUrl) {
          toast.success('Redirecting to checkout...', {
            autoClose: 1000,
            closeButton: true,
            icon: () => <CreditCard className="h-4 w-4" />,
          });
          setRedirectUrl(data.checkoutUrl);
        } else {
          toast.error('Failed to create checkout session');
        }
      },
      onError: (err) => {
        setProcessingPlanId(null);
        handleError(err);
      },
      onSettled: () => {
        // If redirect didn't happen (e.g., error), clear processing state
        setTimeout(() => setProcessingPlanId(null), 1500);
      },
    }),
  );
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
      onError: (err) => {
        setProcessingPlanId(null);
        handleError(err);
      },
      onSettled: () => {
        setTimeout(() => setProcessingPlanId(null), 1500);
      },
    }),
  );
  // Determine if a specific plan should show its own processing state
  const getPlanLoading = (planId: string) => processingPlanId === planId;

  const handlePlanSelect = (plan: (typeof pricingPlans)[0]) => {
    // If Clerk is still loading, don't proceed
    if (!isLoaded) {
      return;
    }

    // If user is not authenticated, redirect to sign-in
    if (!isSignedIn) {
      setRedirectUrl('/sign-in');
      return;
    }

    // localstripe has no Checkout/billing-portal API, so the CTAs can't work in
    // dev — grant tiers from the admin page instead.
    if (isDev) {
      toast.info('Checkout is unavailable in dev — set tiers from /admin.');
      return;
    }

    // Check if this is the user's current plan
    const currentSubscription = subscription.data?.subscription ?? 'Basic';

    // For all paid plans, decide between checkout (new subscription) or dashboard (existing subscription)
    // Set which plan is being processed so only that button shows spinner
    setProcessingPlanId(plan.id);

    if (currentSubscription === 'Basic') {
      // User has no paid subscription, use regular checkout
      createCheckoutSession.mutate({ productId: plan.id });
    } else {
      // User has a paid subscription, use Stripe dashboard for all changes
      createDashboardSession.mutate();
    }
  };

  return (
    <div className="container mx-auto px-4 py-16">
      {/* Header */}
      <div className="mb-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="text-foreground text-4xl font-extrabold sm:text-5xl">
            Pricing
          </h1>
          <p className="text-muted-foreground mx-auto mt-6 max-w-3xl text-xl">
            All paid plans include our core features with different usage
            limits.
          </p>
        </motion.div>

        {isDev && (
          <div className="mx-auto mt-8 max-w-3xl rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <strong className="font-semibold">Dev mode:</strong> checkout is
            unavailable here — local billing runs on localstripe, which has no
            Checkout API. Set a subscription tier from the{' '}
            <a href="/admin" className="font-semibold underline">
              admin page
            </a>{' '}
            instead.
          </div>
        )}
      </div>

      {/* Pricing Cards */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="mx-auto grid max-w-7xl grid-cols-1 gap-8 lg:grid-cols-3"
      >
        {pricingPlans.map((plan, index) => {
          const colors = getTierColors(plan.id, plan.popular, plan.highlight);
          const buttonState = getButtonState(
            plan,
            subscription.data?.subscription,
            subscription.isPending,
            isSignedIn,
            isLoaded,
          );
          const planIsLoading = getPlanLoading(plan.id);

          return (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              whileHover={{
                scale: 1.02,
                boxShadow:
                  '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              }}
              className={plan.highlight ? 'lg:scale-105' : ''}
            >
              <Card
                className={`relative h-full overflow-hidden shadow-md ${colors.border}`}
              >
                {/* Popular Badge */}
                {plan.popular && (
                  <div
                    className={`absolute top-0 right-0 rounded-xs px-3 py-1 text-xs font-medium text-white ${colors.badge}`}
                  >
                    <Star className="mr-1 inline h-3 w-3" />
                    Most Popular
                  </div>
                )}

                <CardHeader className="pb-6">
                  <div className="mb-4">
                    <CardTitle className="text-foreground text-xl font-bold">
                      {plan.name}
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                      {plan.description}
                    </CardDescription>
                  </div>

                  {/* Pricing */}
                  <div className="space-y-2">
                    {plan.monthlyPrice === null ? (
                      <div className="text-foreground text-2xl font-bold">
                        Custom Pricing
                      </div>
                    ) : (
                      <>
                        <div className="flex items-baseline space-x-2">
                          <span
                            className={`text-4xl font-bold ${colors.accent}`}
                          >
                            {plan.monthlyPrice === 0
                              ? 'Free'
                              : `£${plan.monthlyPrice}`}
                          </span>
                          {plan.monthlyPrice > 0 && (
                            <span className="text-muted-foreground">
                              /month
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground text-sm">
                          {plan.credits?.toLocaleString()} credits included
                        </div>
                      </>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="pt-0">
                  {/* CTA Button */}
                  {buttonState.variant === 'loading' ? (
                    <ButtonSkeleton colors={colors} />
                  ) : (
                    <Button
                      className={`mb-6 w-full ${
                        buttonState.variant === 'selected'
                          ? `${colors.button} cursor-default opacity-75`
                          : colors.button
                      }`}
                      onClick={() => handlePlanSelect(plan)}
                      disabled={planIsLoading || buttonState.disabled}
                    >
                      {planIsLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          {buttonState.variant === 'selected' && (
                            <Check className="mr-2 h-4 w-4" />
                          )}
                          {buttonState.variant === 'signin' &&
                            plan.id === 'basic' && (
                              <Users className="mr-2 h-4 w-4" />
                            )}
                          {buttonState.variant !== 'selected' &&
                            buttonState.variant !== 'signin' &&
                            plan.id === 'enterprise' && (
                              <Users className="mr-2 h-4 w-4" />
                            )}
                          {buttonState.variant !== 'selected' &&
                            buttonState.variant !== 'signin' &&
                            plan.id !== 'enterprise' && (
                              <CreditCard className="mr-2 h-4 w-4" />
                            )}
                          {buttonState.variant === 'signin' &&
                            plan.id !== 'basic' && (
                              <CreditCard className="mr-2 h-4 w-4" />
                            )}
                          {buttonState.text}
                        </>
                      )}
                    </Button>
                  )}

                  {/* Features List */}
                  <div className="space-y-3">
                    <h4 className="text-foreground font-medium">
                      Features included:
                    </h4>
                    <ul className="space-y-2">
                      {plan.features.map((feature, i) => (
                        <li key={i} className="flex items-start space-x-3">
                          {feature.included ? (
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                          ) : (
                            <X className="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
                          )}
                          <div>
                            <span
                              className={`text-sm ${
                                feature.included
                                  ? 'text-foreground'
                                  : 'text-muted-foreground line-through'
                              }`}
                            >
                              {feature.name}
                            </span>
                            {feature.description && feature.included && (
                              <p className="text-muted-foreground mt-0.5 text-xs">
                                {feature.description}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
