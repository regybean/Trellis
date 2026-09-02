'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import type { SignInCredentials } from '@acme/ui';
import { SignInForm, toSameSitePath } from '@acme/ui';

import { authClient } from '~/lib/auth-client';

/**
 * Sign-in page. The form is `@acme/ui`'s presentational `SignInForm` — it owns
 * field validation, the pending state and the rejection message — and this page
 * owns everything provider-specific: the Better Auth call and where a successful
 * sign-in lands.
 *
 * A plain `/sign-in` route, not the `[[...sign-in]]` catch-all a hosted
 * provider's pages needed. `redirect` carries the route the middleware bounced
 * the visitor from, so they resume where they were — normalised by
 * `toSameSitePath`, which
 * is shared with `apps/tanstack-start`: the parameter is attacker-controlled, so
 * `?redirect=https://evil.example` (or the protocol-relative `//evil.example`)
 * has to land on `/` rather than walk the visitor off-site at the exact moment
 * they authenticate.
 */
export default function SignInPage() {
  const router = useRouter();
  const redirectTo = toSameSitePath(useSearchParams().get('redirect'));

  const handleSubmit = async ({ email, password }: SignInCredentials) => {
    const { error } = await authClient.signIn.email({ email, password });

    if (error) {
      // Better Auth answers a bad email and a bad password identically
      // ("Invalid email or password"), which is the behaviour we want — the form
      // must not tell an attacker which half was wrong.
      return error.message ?? 'Could not sign in. Please try again.';
    }

    // The session cookie is set by the auth route handler, so the server can see
    // it on the very next request. `refresh()` re-runs the Server Components
    // with it, and `replace` keeps the sign-in page out of the back history.
    router.replace(redirectTo);
    router.refresh();
    return null;
  };

  return (
    <div className="flex h-screen items-center justify-center">
      <SignInForm onSubmit={handleSubmit} />
    </div>
  );
}
