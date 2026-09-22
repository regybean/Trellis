import { createFileRoute } from '@tanstack/react-router';

import { PricingPage } from '@acme/billing';

export const Route = createFileRoute('/pricing')({
  component: PricingRoute,
});

/**
 * The dev-mode banner in `PricingPage` links to the tier setter, which only an
 * admin can use. Billing cannot decide that itself — features are
 * auth-agnostic — so the role comes off the root route's server-resolved
 * context and the path is passed only when the viewer can follow it.
 */
function PricingRoute() {
  const { role } = Route.useRouteContext();

  return (
    <div className="min-h-full flex-grow p-5">
      <PricingPage adminPath={role === 'admin' ? '/admin' : undefined} />
    </div>
  );
}
