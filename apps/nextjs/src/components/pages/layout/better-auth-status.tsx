'use client';

import type { ReactNode } from 'react';

import { AuthStatusProvider, resolvedAuthStatus } from '@acme/hooks';

import { authClient } from '~/lib/auth-client';

/**
 * This app's half of the client auth seam (`@acme/hooks`): maps Better Auth's
 * `useSession()` onto the neutral `AuthStatus` the features read — chiefly
 * `@acme/billing`, which gates its viewer-scoped queries on it. Features never
 * learn which provider is mounted (ADR 0003).
 *
 * `initialUserId` is the id the root layout already resolved on the server.
 * Better Auth's client fetches the session itself, so without a seed the first
 * client render would report "still loading" even for a signed-in visitor —
 * enough to flash a signed-out header. Seeding also means `isLoaded` is true
 * immediately, so a viewer-scoped query fires on the first render rather than
 * the second.
 *
 * The mapping is duplicated in `apps/tanstack-start` rather than shared, and
 * that is the seam working as designed: `authClient` is app-owned (each app
 * builds its own), and a shared component would have to pull `better-auth` into
 * the substrate — which the slim, no-auth apps must never see (ADR 0010).
 */
export function BetterAuthStatusProvider({
  initialUserId,
  children,
}: {
  initialUserId: string | null;
  children: ReactNode;
}) {
  const { data, isPending } = authClient.useSession();

  // Until the client's own fetch resolves, the server-resolved session is the
  // better answer; after it resolves it is the authoritative one (it reflects a
  // sign-out that happened in this tab).
  const status = isPending
    ? resolvedAuthStatus(initialUserId)
    : resolvedAuthStatus(data?.user.id ?? null);

  return <AuthStatusProvider status={status}>{children}</AuthStatusProvider>;
}
