import { createFileRoute } from '@tanstack/react-router';

import { PricingPage } from '@acme/billing';

export const Route = createFileRoute('/pricing')({
  component: PricingRoute,
});

function PricingRoute() {
  return (
    <div className="min-h-full flex-grow p-5">
      <PricingPage />
    </div>
  );
}
