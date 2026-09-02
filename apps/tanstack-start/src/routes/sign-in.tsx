import { createFileRoute, useNavigate } from '@tanstack/react-router';

import type { SignInCredentials } from '@acme/ui';
import { authSearchSchema, SignInForm } from '@acme/ui';

import { authClient } from '~/lib/auth-client';

/**
 * In-app sign-in. A plain route, not the catch-all `/sign-in/$` this replaces:
 * the splat existed so Clerk's prebuilt component could own sub-routes for SSO
 * callbacks, and with email/password against our own handler there are none
 * (ADR 0034).
 *
 * The form is `@acme/ui`'s `SignInForm` — presentational and prop-driven, shared
 * with the Next.js app. This route owns the provider call and where a success
 * lands, which is the whole point of that split: `@acme/ui` needs no
 * `@acme/auth` dependency, so the slim apps' graph is unaffected (ADR 0010).
 *
 * `authSearchSchema` is that same shared module: it normalises `?redirect=` to a
 * same-site path, so a visitor arriving with `?redirect=https://evil.example` or
 * `?redirect=//evil.example` lands on `/` rather than being walked off-site the
 * instant they authenticate.
 */
export const Route = createFileRoute('/sign-in')({
  validateSearch: authSearchSchema,
  component: SignInRoute,
});

function SignInRoute() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();

  const submit = async (credentials: SignInCredentials) => {
    // Better Auth's client returns `{ data, error }` rather than throwing, so a
    // rejected credential is an ordinary value to hand back — no try/catch.
    const { error } = await authClient.signIn.email(credentials);

    if (error) {
      // Deliberately not distinguishing "no such user" from "wrong password":
      // Better Auth returns one message for both, and echoing anything sharper
      // would turn the form into an account-enumeration oracle.
      return error.message ?? 'Could not sign in. Check your details.';
    }

    // `reloadDocument` is load-bearing, not a shortcut. Each feature's
    // `TRPCReactProvider` builds its IndexedDB persister once, at mount, keyed
    // on the signed-in id that `__root`'s `beforeLoad` resolves on the *server*
    // (see PersistedFeatureProviders): an SPA transition would hand the
    // already-mounted providers a scope key they no longer read, and the
    // just-signed-in user would get no persistence until their next hard load. A
    // document load re-runs SSR with the session cookie in place, which is also
    // what Clerk's redirect did.
    await navigate({ href: redirect ?? '/', reloadDocument: true });
    return null;
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <SignInForm onSubmit={submit} />
    </div>
  );
}
