'use client';

import type { ReactNode } from 'react';
import { useSubscription } from '@trpc/tanstack-react-query';

import type { AuthStatus } from '@acme/hooks';
import { useOptionalAuthStatus } from '@acme/hooks';
import { logger } from '@acme/logger';

import type { NotificationRenderers } from './dispatch';
import { dispatchNotification } from './dispatch';
import { NotificationsTRPCProvider, useTRPC } from './trpc/react';

/**
 * The one self-contained seam an app mounts to turn per-user notifications into
 * toasts (ADR 0001). It renders its own tRPC provider and, inside it, a headless
 * always-on tail child — so NO page owns the subscription hook: notifications are
 * chrome, not a page feature. Mount it once per app, adjacent to the ingest tRPC
 * provider; the mount is byte-identical in all 4 apps (no persister, no
 * `scopeKey`, no client principal — the server keys `userId` from `ctx`).
 *
 * It adds no `<ToastContainer/>` — the app already mounts one via
 * `<ToastThemeClient/>`; the default renderer toasts into it.
 */
export function NotificationsProvider({
  renderers,
  children,
}: {
  // App-assembled `kind`→renderer registry. Optional: a plain-text kind needs
  // no entry (it falls through to the default toast renderer).
  renderers?: NotificationRenderers;
  children: ReactNode;
}) {
  return (
    <NotificationsTRPCProvider>
      <NotificationTail renderers={renderers} />
      {children}
    </NotificationsTRPCProvider>
  );
}

/**
 * Headless: subscribes to `notifications.stream` and dispatches each event to
 * its renderer, rendering nothing. Live on every page — notifications are
 * cross-cutting chrome — but only once the viewer is actually signed in, because
 * `stream` is a `protectedProcedure`: subscribing while signed out earns an
 * UNAUTHORIZED that tRPC then retries, so a visit to `/sign-in` used to produce
 * a burst of error-level logs for a denial that was never actionable.
 *
 * Reconnect is silent and automatic — tRPC retries recoverable drops and replays
 * `lastEventId`; an unrecoverable error is logged (no connection UI). No consumer
 * hook is exported (an inbox is out of scope).
 */
/**
 * Whether the tail should hold a subscription open, given the app's auth seam.
 *
 * Split out as a named predicate because the two branches are not symmetric and
 * jsdom cannot observe the difference: the SSE transport never connects there
 * (ADR 0018), so "does it subscribe when signed in" is not assertable at the
 * HTTP boundary the way "does it stay quiet when signed out" is. This keeps the
 * rule itself directly testable without mocking a seam the feature owns.
 *
 * `null` is an app with no `AuthStatusProvider` — the slim apps, which inject a
 * synthetic session server-side (ADR 0010). For them an absent provider means
 * "always authorized", so it must stay enabled rather than read as signed-out
 * and go dark. Everywhere else this waits for a *resolved* signed-in session:
 * `isSignedIn` is false while `isLoaded` is still false, so the subscription is
 * also held back through the first client render rather than firing against a
 * session nobody has resolved yet.
 */
export function shouldTailNotifications(authStatus: AuthStatus | null) {
  return authStatus === null || authStatus.isSignedIn;
}

function NotificationTail({
  renderers,
}: {
  renderers?: NotificationRenderers;
}) {
  const trpc = useTRPC();
  const authStatus = useOptionalAuthStatus();

  useSubscription({
    ...trpc.notifications.stream.subscriptionOptions({}),
    enabled: shouldTailNotifications(authStatus),
    onData: ({ data }) => dispatchNotification(data, renderers),
    onError: (error) =>
      logger.error({ err: error }, 'notifications.stream: reader error'),
  });

  return null;
}
