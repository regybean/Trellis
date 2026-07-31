// Isomorphic schema surface (`./schema`): the envelope zod schema + types, safe
// on client and server (no `server-only` guard, no React). A consuming feature
// imports this to build its typed `publish` wrapper and its custom renderer's
// `data` parser; the server's `publish` validates against the same shape.
export {
  notificationSchema,
  publishInputSchema,
  notificationLevelSchema,
} from './api/schemas/notification-schema';
export type {
  Notification,
  PublishInput,
  NotificationLevel,
} from './api/schemas/notification-schema';
