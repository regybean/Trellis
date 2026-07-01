'use client';

import { useState } from 'react';
import { CreditCard, Loader2, TestTube } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@acme/ui';

import { env } from '../../env';
import { useStripeTesting } from '../../hooks/use-stripe-testing';

export function StripeTesting() {
  const [activeTest, setActiveTest] = useState<null | 'standard' | 'pro'>(null);
  const { testCheckout, isCreatingCheckout, runFeatureTest } =
    useStripeTesting();

  const runTest = async (which: 'standard' | 'pro') => {
    setActiveTest(which);
    try {
      await runFeatureTest(which);
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
                testCheckout(env.NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID)
              }
              className="bg-primary text-on-primary hover:bg-primary/90"
              disabled={isCreatingCheckout}
            >
              {isCreatingCheckout ? (
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
