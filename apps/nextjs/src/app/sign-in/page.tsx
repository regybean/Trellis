'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import type { SignInCredentials } from '@acme/ui';
import { SignInForm } from '@acme/ui';

import { authClient } from '~/lib/auth-client';

/**
 * Sign-in page (#223). The form is `@acme/ui`'s presentational `SignInForm`
 * (#222) — it owns field validation and the pending/error rendering — and this
 * page owns everything provider-specific: the Better Auth call, the error
 * message it surfaces, and where a successful sign-in lands.
 *
 * A plain `/sign-in` route, not the `[[...sign-in]]` catch-all Clerk's hosted
 * pages needed. `redirect` carries the route the middleware bounced the visitor
 * from, so they resume where they were.
 */
export default function SignInPage() {
  const router = useRouter();
  const redirectTo = useSearchParams().get('redirect') ?? '/';
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async ({ email, password }: SignInCredentials) => {
    setPending(true);
    setError(null);

    const { error: signInError } = await authClient.signIn.email({
      email,
      password,
    });

    if (signInError) {
      // Better Auth answers a bad email and a bad password identically
      // ("Invalid email or password"), which is the behaviour we want — the form
      // must not tell an attacker which half was wrong.
      setError(signInError.message ?? 'Could not sign in. Please try again.');
      setPending(false);
      return;
    }

    // The session cookie is set by the auth route handler, so the server can see
    // it on the very next request. `refresh()` re-runs the Server Components
    // with it, and `replace` keeps the sign-in page out of the back history.
    router.replace(redirectTo);
    router.refresh();
  };

  return (
    <div className="flex h-screen items-center justify-center">
      <SignInForm
        onSubmit={(credentials) => void handleSubmit(credentials)}
        error={error}
        pending={pending}
      />
    </div>
  );
}
