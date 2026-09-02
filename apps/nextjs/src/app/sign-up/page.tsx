'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import type { SignUpCredentials } from '@acme/ui';
import { SignUpForm } from '@acme/ui';

import { authClient } from '~/lib/auth-client';

/**
 * Sign-up page (#223). Mirrors the sign-in page: `@acme/ui`'s presentational
 * `SignUpForm` (#222) plus this app's Better Auth wiring.
 *
 * Better Auth signs a new account in as part of `signUp.email` (its
 * `autoSignIn` default), so there is no second sign-in hop — registering lands
 * the visitor on the post-auth route already authenticated.
 */
export default function SignUpPage() {
  const router = useRouter();
  const redirectTo = useSearchParams().get('redirect') ?? '/';
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async ({ name, email, password }: SignUpCredentials) => {
    setPending(true);
    setError(null);

    const { error: signUpError } = await authClient.signUp.email({
      name,
      email,
      password,
    });

    if (signUpError) {
      // The common case here is a duplicate email; Better Auth's message is
      // already user-facing, so it is shown rather than replaced.
      setError(
        signUpError.message ??
          'Could not create your account. Please try again.',
      );
      setPending(false);
      return;
    }

    router.replace(redirectTo);
    router.refresh();
  };

  return (
    <div className="flex h-screen items-center justify-center">
      <SignUpForm
        onSubmit={(credentials) => void handleSubmit(credentials)}
        error={error}
        pending={pending}
      />
    </div>
  );
}
