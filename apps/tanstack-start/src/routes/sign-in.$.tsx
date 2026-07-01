import { dark } from '@clerk/themes';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { SignIn } from '@acme/auth';
import { useTheme } from '@acme/ui';

// In-app auth page (catch-all so Clerk can own its sub-routes, e.g. SSO
// callbacks). The wrapper is app-owned; the Clerk theme follows `resolvedTheme`
// (consistent with the Next.js sign-in page) rather than being force-locked.
export const Route = createFileRoute('/sign-in/$')({
  validateSearch: z.object({ redirect_url: z.string().optional() }),
  component: SignInRoute,
});

function SignInRoute() {
  const { resolvedTheme } = useTheme();
  const { redirect_url } = Route.useSearch();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <SignIn
        appearance={{ baseTheme: resolvedTheme === 'dark' ? dark : undefined }}
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl={redirect_url ?? '/'}
      />
    </div>
  );
}
