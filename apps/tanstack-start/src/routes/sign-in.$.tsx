import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { SignIn } from '@acme/auth';

// In-app auth page (catch-all so Clerk can own its sub-routes, e.g. SSO
// callbacks). The dark Clerk theme is applied globally on the root
// `<ClerkProvider>`; the wrapper is app-owned.
export const Route = createFileRoute('/sign-in/$')({
  validateSearch: z.object({ redirect_url: z.string().optional() }),
  component: SignInRoute,
});

function SignInRoute() {
  const { redirect_url } = Route.useSearch();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl={redirect_url ?? '/'}
      />
    </div>
  );
}
