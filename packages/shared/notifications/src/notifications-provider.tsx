'use client';

import type { ReactNode } from 'react';
import { useSubscription } from '@trpc/tanstack-react-query';

import { logger } from '@acme/logger';

import type { NotificationRenderers } from './dispatch';
import { dispatchNotification } from './dispatch';
import { NotificationsTRPCProvider, useTRPC } from './trpc/react';

/**
 * The one self-contained seam an app mounts to turn per-user notifications into
 * toasts (ADR 0030). It renders its own tRPC provider and, inside it, a headless
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
 * its renderer, rendering nothing. Always enabled (notifications are cross-cutting
 * chrome, live on every page). Reconnect is silent and automatic — tRPC retries
 * recoverable drops and replays `lastEventId`; an unrecoverable error is logged
 * (no connection UI). No consumer hook is exported (an inbox is out of scope).
 */
function NotificationTail({
  renderers,
}: {
  renderers?: NotificationRenderers;
}) {
  const trpc = useTRPC();

  useSubscription({
    ...trpc.notifications.stream.subscriptionOptions({}),
    enabled: true,
    onData: ({ data }) => dispatchNotification(data, renderers),
    onError: (error) =>
      logger.error({ err: error }, 'notifications.stream: reader error'),
  });

  return null;
}
