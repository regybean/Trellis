import { Suspense } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { StripeSuccessLoading, StripeSuccessRedirect } from '@acme/billing';
import { StripeSuccessHandler } from '@acme/billing/server-next';

import { auth } from '~/server/auth';

/**
 * Post-checkout landing page. The viewer is resolved here and passed down: auth
 * is app-owned (ADR 0003), so `StripeSuccessHandler` takes the id rather than
 * reaching for a provider itself (#223).
 */
export default async function StripeProcessingPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect('/sign-in?redirect=/stripe/success');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-blue-50 via-indigo-50 to-purple-50 p-4">
      <div className="w-full max-w-md rounded-lg border border-blue-100 bg-white p-8 text-center shadow-xl">
        <Suspense fallback={<StripeSuccessLoading />}>
          <StripeSuccessHandler userId={session.user.id} />
        </Suspense>
        <StripeSuccessRedirect />
      </div>
    </div>
  );
}
