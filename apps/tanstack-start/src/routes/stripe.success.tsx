import { createFileRoute } from '@tanstack/react-router';
import { Database, RefreshCw } from 'lucide-react';

import { StripeSuccessRedirect } from '../components/stripe/stripe-success';
import { syncStripeOnSuccess } from '../lib/stripe';

// The loader runs the app-owned sync server function (auth + Stripe→KV sync,
// redirecting if signed-out or no customer), then the page shows a brief
// processing state while `StripeSuccessRedirect` invalidates billing queries
// and routes home.
export const Route = createFileRoute('/stripe/success')({
  loader: () => syncStripeOnSuccess(),
  component: StripeSuccessRoute,
});

function StripeSuccessRoute() {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="border-border bg-card w-full max-w-md rounded-lg border p-8 text-center shadow-xl">
        <div className="flex flex-col items-center space-y-6">
          <div className="relative">
            <Database className="text-primary h-16 w-16" />
            <RefreshCw className="text-primary absolute -top-2 -right-2 h-6 w-6 animate-spin" />
          </div>
          <div className="text-center">
            <h2 className="mb-2 text-2xl font-bold">Processing Your Data</h2>
            <p className="text-muted-foreground mb-4">
              We&apos;re syncing your subscription data and setting up your
              account.
            </p>
          </div>
        </div>
        <StripeSuccessRedirect />
      </div>
    </div>
  );
}
