'use client';

import type { ReactNode } from 'react';

import type { AuthStatus } from '@acme/hooks';
import { AuthStatusProvider } from '@acme/hooks';

import { authClient } from '~/lib/auth-client';

/**
 * This app's half of the client auth seam (`@acme/hooks`): maps Better Auth's
 * `useSession()` onto the neutral `AuthStatus` the features read — chiefly
 * `@acme/billing`, which gates its viewer-scoped queries on it. Features never
 * learn which provider is mounted (ADR 0003), which is what lets this app run
 * Better Auth while `apps/tanstack-start` is still on Clerk.
 *
 * `initialStatus` is the session the root layout already resolved on the server.
 * Better Auth's client fetches the session itself, so without a seed the first
 * client render would report "still loading" even for a signed-in visitor —
 * enough to flash a signed-out header. Seeding also means `isLoaded` is true
 * immediately, so a viewer-scoped query fires on the first render rather than
 * the second.
 */
export function BetterAuthStatusProvider({
  initialStatus,
  children,
}: {
  initialStatus: AuthStatus;
  children: ReactNode;
}) {
  const { data, isPending } = authClient.useSession();

  // Until the client's own fetch resolves, the server-resolved session is the
  // better answer; after it resolves it is the authoritative one (it reflects a
  // sign-out that happened in this tab).
  const status: AuthStatus = isPending
    ? initialStatus
    : {
        userId: data?.user.id ?? null,
        isSignedIn: Boolean(data?.user),
        isLoaded: true,
      };

  return <AuthStatusProvider status={status}>{children}</AuthStatusProvider>;
}
