import { Suspense } from 'react';

import { StripeSuccessLoading, StripeSuccessRedirect } from '@acme/billing';
import { StripeSuccessHandler } from '@acme/billing/server';

export default function StripeProcessingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-blue-50 via-indigo-50 to-purple-50 p-4">
      <div className="w-full max-w-md rounded-lg border border-blue-100 bg-white p-8 text-center shadow-xl">
        <Suspense fallback={<StripeSuccessLoading />}>
          <StripeSuccessHandler />
        </Suspense>
        <StripeSuccessRedirect />
      </div>
    </div>
  );
}
