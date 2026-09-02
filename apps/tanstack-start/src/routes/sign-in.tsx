import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import type { SignInCredentials } from '@acme/ui';
import { SignInForm } from '@acme/ui';

import { authClient } from '~/lib/auth-client';
import { authSearchSchema } from '~/lib/redirect-target';

/**
 * In-app sign-in. A plain route, not the catch-all `/sign-in/$` this replaces:
 * the splat existed so Clerk's prebuilt component could own sub-routes for SSO
 * callbacks, and with email/password against our own handler there are none
 * (ADR 0034).
 *
 * The form is `@acme/ui`'s `SignInForm` — presentational and prop-driven, shared
 * with the Next.js app. This route owns the provider call, which is the whole
 * point of that split: `@acme/ui` needs no `@acme/auth` dependency, so the slim
 * apps' graph is unaffected (ADR 0010).
 */
export const Route = createFileRoute('/sign-in')({
  validateSearch: authSearchSchema,
  component: SignInRoute,
});

function SignInRoute() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (credentials: SignInCredentials) => {
    setError(null);
    setPending(true);

    // Better Auth's client returns `{ data, error }` rather than throwing, so a
    // rejected credential is an ordinary value to render — no try/catch.
    const { error: failure } = await authClient.signIn.email(credentials);

    if (failure) {
      // Deliberately not distinguishing "no such user" from "wrong password":
      // Better Auth returns one message for both, and echoing anything sharper
      // would turn the form into an account-enumeration oracle.
      setError(failure.message ?? 'Could not sign in. Check your details.');
      setPending(false);
      return;
    }

    // `reloadDocument` is load-bearing, not a shortcut. Each feature's
    // `TRPCReactProvider` creates its QueryClient once and attaches an
    // IndexedDB persister keyed on the signed-in id, which `__root`'s
    // `beforeLoad` resolves on the *server* (see PersistedFeatureProviders): an
    // SPA transition would hand the already-mounted singletons a scope key they
    // no longer read, and the just-signed-in user would get no persistence
    // until their next hard load. A document load re-runs SSR with the session
    // cookie in place, which is also what Clerk's redirect did.
    await navigate({ href: redirect ?? '/', reloadDocument: true });
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <SignInForm
        onSubmit={(credentials) => void submit(credentials)}
        error={error}
        pending={pending}
      />
    </div>
  );
}
