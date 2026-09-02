import { createFileRoute, useNavigate } from '@tanstack/react-router';

import type { SignUpCredentials } from '@acme/ui';
import { authSearchSchema, SignUpForm } from '@acme/ui';

import { authClient } from '~/lib/auth-client';

/**
 * In-app registration, the mirror of `sign-in.tsx`. `signUp.email` creates the
 * `user` row, the `credential` `account` row holding the scrypt hash, *and* a
 * session — so a successful registration lands the visitor signed in, with no
 * second sign-in call.
 */
export const Route = createFileRoute('/sign-up')({
  validateSearch: authSearchSchema,
  component: SignUpRoute,
});

function SignUpRoute() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();

  const submit = async (credentials: SignUpCredentials) => {
    const { error } = await authClient.signUp.email(credentials);

    if (error) {
      // The message a caller will actually hit here is the duplicate-email one,
      // which Better Auth returns because `user.email` is unique. Rendering it
      // verbatim is the honest thing: the address is one the person just typed,
      // so it discloses nothing they could not learn from the sign-in form.
      return error.message ?? 'Could not create your account.';
    }

    // Same document load as sign-in, for the same reason — see the note there.
    await navigate({ href: redirect ?? '/', reloadDocument: true });
    return null;
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <SignUpForm onSubmit={submit} />
    </div>
  );
}
