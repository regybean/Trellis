import { headers } from 'next/headers';

import { readSessionRole } from '@acme/auth/server';
import { PricingPage } from '@acme/billing';

import { auth } from '~/server/auth';

/**
 * The dev-mode banner in `PricingPage` links to the tier setter, and only an
 * admin can use it. Billing cannot decide that itself — features are
 * auth-agnostic — so the role is resolved here and the path is passed only when
 * the viewer can follow it.
 */
export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  const isAdmin = session ? readSessionRole(session.user) === 'admin' : false;

  return (
    <div className="bg-muted min-h-screen flex-grow p-5">
      <PricingPage adminPath={isAdmin ? '/admin' : undefined} />
    </div>
  );
}
