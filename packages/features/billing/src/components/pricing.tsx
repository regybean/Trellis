'use client';

import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Check,
  Clock,
  CreditCard,
  Info,
  Loader2,
  RefreshCw,
  Star,
  Users,
  X,
} from 'lucide-react';
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
  creditUsageExamples,
  enterprisePlan,
  getButtonState,
  getTierColors,
  pricingPlans,
} from '../data/pricing-data';
import { useTRPC } from '../trpc/react';
import { ButtonSkeleton } from './pricing-components';
import { SubscriptionCancellation } from './stripe/stripe-cancellation';

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

    if (plan.id === 'enterprise') {
      // Redirect to contact page or open contact modal
      setRedirectUrl('mailto:info@acme.co.uk');
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
          <h1 className="text-text text-4xl font-extrabold sm:text-5xl">
            Pricing
          </h1>
          <p className="text-text-secondary mx-auto mt-6 max-w-3xl text-xl">
            All paid plans include our core features with different usage
            limits.
          </p>
        </motion.div>
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
                    <CardTitle className="text-text text-xl font-bold">
                      {plan.name}
                    </CardTitle>
                    <CardDescription className="text-text-secondary">
                      {plan.description}
                    </CardDescription>
                  </div>

                  {/* Pricing */}
                  <div className="space-y-2">
                    {plan.monthlyPrice === null ? (
                      <div className="text-text text-2xl font-bold">
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
                            <span className="text-text-secondary">/month</span>
                          )}
                        </div>
                        <div className="text-text-secondary text-sm">
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
                    <h4 className="text-text font-medium">
                      Features included:
                    </h4>
                    <ul className="space-y-2">
                      {plan.features.map((feature, i) => (
                        <li key={i} className="flex items-start space-x-3">
                          {feature.included ? (
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                          ) : (
                            <X className="text-text-secondary mt-0.5 h-4 w-4 flex-shrink-0" />
                          )}
                          <div>
                            <span
                              className={`text-sm ${
                                feature.included
                                  ? 'text-text'
                                  : 'text-text-secondary line-through'
                              }`}
                            >
                              {feature.name}
                            </span>
                            {feature.description && feature.included && (
                              <p className="text-text-secondary mt-0.5 text-xs">
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

      {/* Enterprise Plan - Separate Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.8 }}
        className="mt-16"
      >
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 text-center">
            <h3 className="text-text text-2xl font-bold">
              Enterprise Solution
            </h3>
            <p className="text-text-secondary mt-2">
              Built for large organisations with custom requirements
            </p>
          </div>

          <Card className="overflow-hidden border-amber-200 shadow-lg ring-1 ring-amber-100 dark:border-amber-700 dark:ring-amber-800">
            <CardContent className="p-8">
              <div className="grid gap-8 lg:grid-cols-2">
                {/* Left side - Plan info */}
                <div>
                  <div className="mb-6 flex items-center">
                    <div className="mr-4 rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
                      <Users className="h-8 w-8 text-amber-700 dark:text-amber-300" />
                    </div>
                    <div>
                      <h4 className="text-text text-xl font-bold">
                        {enterprisePlan.name}
                      </h4>
                      <p className="text-text-secondary">
                        {enterprisePlan.description}
                      </p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <div className="mb-2 text-3xl font-bold text-amber-700 dark:text-amber-300">
                      Custom Pricing
                    </div>
                    <p className="text-text-secondary text-sm">
                      Tailored solutions based on your specific needs and usage
                      requirements
                    </p>
                  </div>

                  <Button
                    size="lg"
                    className="w-full bg-amber-600 text-white hover:bg-amber-700 lg:w-auto"
                    onClick={() => handlePlanSelect(enterprisePlan)}
                    disabled={false} // Enterprise plan just opens email, no loading needed
                  >
                    <Users className="mr-2 h-4 w-4" />
                    {enterprisePlan.cta}
                  </Button>
                </div>

                {/* Right side - Features */}
                <div>
                  <h5 className="text-text mb-4 font-medium">
                    Enterprise Features:
                  </h5>
                  <ul className="space-y-3">
                    {enterprisePlan.features.map((feature, i) => (
                      <li key={i} className="flex items-start space-x-3">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                        <div>
                          <span className="text-text text-sm">
                            {feature.name}
                          </span>
                          {feature.description && (
                            <p className="text-text-secondary mt-0.5 text-xs">
                              {feature.description}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Credit System Explanation */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1 }}
        className="mt-16"
      >
        <Card className="border-border mx-auto max-w-6xl shadow-xs">
          <CardHeader>
            <CardTitle className="text-text flex items-center justify-center">
              <Info className="text-text-accent mr-2 h-5 w-5" />
              How Credits Work
            </CardTitle>
            <CardDescription className="text-text-secondary text-center">
              Credits are your usage currency - they reset monthly from your
              subscription start date
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {creditUsageExamples.map((example, index) => (
                <div
                  key={index}
                  className="border-background-primary bg-background-secondary/50 flex items-start space-x-3 rounded-lg border border-dashed p-3"
                >
                  <example.icon className="text-text-accent mt-0.5 h-5 w-5 flex-shrink-0" />
                  <div>
                    <h4 className="text-text text-sm font-medium">
                      {example.title}
                    </h4>
                    <p className="text-text-secondary text-xs">
                      {example.description}
                    </p>
                    <p className="text-text-accent mt-1 text-xs font-medium">
                      {example.credits}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="text-text-secondary mt-6 flex items-center justify-center space-x-6 text-sm">
              <div className="flex items-center space-x-2">
                <RefreshCw className="h-4 w-4" />
                <span>Credits reset monthly</span>
              </div>
              <div className="flex items-center space-x-2">
                <Clock className="h-4 w-4" />
                <span>From your subscription start date</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* FAQ Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1 }}
        className="mt-20"
      >
        <Card className="border-border mx-auto max-w-4xl shadow-md">
          <CardHeader>
            <CardTitle className="text-text text-center">
              Frequently Asked Questions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h4 className="text-text mb-2 font-medium">Can I upgrade ?</h4>
                <p className="text-text-secondary text-sm">
                  Yes, you can change your plan at any time with immediate
                  effect. You are billed immediately at a discounted rate and
                  your new term is from the start date of the new plan.
                </p>
              </div>
              <div>
                <h4 className="text-text mb-2 font-medium">
                  What happens if I run out of credits?
                </h4>
                <p className="text-text-secondary text-sm">
                  You can upgrade your plan or wait until your next reset date.
                  We&apos;ll notify you when you&apos;re running low on credits.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Subscription Cancellation - Only show for authenticated users with paid subscriptions */}
      {isSignedIn &&
        subscription.data?.subscription &&
        subscription.data.subscription !== 'Basic' && (
          <SubscriptionCancellation
            subscriptionType={subscription.data.subscription}
            isCancelledAtPeriodEnd={
              subscription.data.cancelAtPeriodEnd || false
            }
            currentPeriodEnd={subscription.data.currentPeriodEnd}
          />
        )}
    </div>
  );
}
