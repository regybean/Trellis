// Client entry (`.`): the self-contained provider an app mounts, the default
// renderer + dispatch helper for assembling a custom `renderers` registry, and
// the envelope type. No separate `/client` subpath — this IS the client surface
// (it carries `'use client'` connectors). Server-only code (`publish`, the
// router) lives behind `./server`; the isomorphic schema behind `./schema`.
export const name = 'notifications';

export { NotificationsProvider } from './notifications-provider';
export { defaultToastRenderer } from './default-renderer';
export { dispatchNotification } from './dispatch';
export type { NotificationRenderer, NotificationRenderers } from './dispatch';
export type { Notification } from './api/schemas/notification-schema';
