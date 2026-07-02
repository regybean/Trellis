'use client';

import { motion } from 'framer-motion';
import { Check, CreditCard, Loader2, Star, Users, X } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@acme/ui';

import { getTierColors } from '../data/pricing-data';
import { usePricing } from '../hooks/use-pricing';
import { ButtonSkeleton } from './pricing-components';

export function PricingPage() {
  const { cards, selectPlan, isDev } = usePricing();

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
        {cards.map(({ plan, buttonState, isProcessing }, index) => {
          const colors = getTierColors(plan.id, plan.popular, plan.highlight);

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
                      onClick={() => selectPlan(plan)}
                      disabled={isProcessing || buttonState.disabled}
                    >
                      {isProcessing ? (
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
