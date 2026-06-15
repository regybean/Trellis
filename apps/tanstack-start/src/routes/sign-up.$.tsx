import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { SignUp } from '@acme/auth';

export const Route = createFileRoute('/sign-up/$')({
  validateSearch: z.object({ redirect_url: z.string().optional() }),
  component: SignUpRoute,
});

function SignUpRoute() {
  const { redirect_url } = Route.useSearch();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl={redirect_url ?? '/'}
      />
    </div>
  );
}
