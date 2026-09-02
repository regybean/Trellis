'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import type { SignUpCredentials } from '@acme/ui';
import { SignUpForm, toSameSitePath } from '@acme/ui';

import { authClient } from '~/lib/auth-client';

/**
 * Sign-up page. Mirrors the sign-in page: `@acme/ui`'s presentational
 * `SignUpForm` plus this app's Better Auth wiring, and the same same-site
 * normalisation of `?redirect=`.
 *
 * Better Auth signs a new account in as part of `signUp.email` (its
 * `autoSignIn` default), so there is no second sign-in hop — registering lands
 * the visitor on the post-auth route already authenticated.
 */
export default function SignUpPage() {
  const router = useRouter();
  const redirectTo = toSameSitePath(useSearchParams().get('redirect'));

  const handleSubmit = async ({ name, email, password }: SignUpCredentials) => {
    const { error } = await authClient.signUp.email({ name, email, password });

    if (error) {
      // The common case here is a duplicate email; Better Auth's message is
      // already user-facing, so it is shown rather than replaced.
      return error.message ?? 'Could not create your account. Please try again.';
    }

    router.replace(redirectTo);
    router.refresh();
    return null;
  };

  return (
    <div className="flex h-screen items-center justify-center">
      <SignUpForm onSubmit={handleSubmit} />
    </div>
  );
}
