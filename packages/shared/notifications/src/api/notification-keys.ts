import { nsKey } from '@acme/redis';

// Redis key builder for the per-user notification stream. All keys go through
// `nsKey` so the app namespace prefix (derived from NEXT_PUBLIC_WEBAPP) is
// applied consistently — one user's stream per app.
//
// `userId` comes from `ctx.session.user` server-side (never a client input). In
// the no-auth slim apps it collapses to the constant `'local'` principal, so
// slim visitors share one `notifications:local` stream — accepted and documented
// (packages/shared/notifications/docs/adr/0001-notifications-seam.md), the same collapse chat/ingest accept.
export const notificationKey = (userId: string) =>
  nsKey('notifications', userId);
