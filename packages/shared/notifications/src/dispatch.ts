import type { Notification } from './api/schemas/notification-schema';
import { defaultToastRenderer } from './default-renderer';

// A renderer turns one notification into a side effect (a toast, usually). The
// registry is keyed by the open `kind` string.
export type NotificationRenderer = (n: Notification) => void;
export type NotificationRenderers = Record<string, NotificationRenderer>;

/**
 * Dispatch one notification to its renderer — factored as a plain, independently
 * callable function (not buried in the subscription callback) so it can be unit-
 * exercised without an un-drivable SSE tail (ADR 0018): the headless tail child
 * is merely one caller.
 *
 * Resolution is `renderers[n.kind] ?? defaultToastRenderer`: a plain-text kind
 * needs zero registration; a rich kind is one app-side map entry. The core never
 * owns the kind→renderer map — the app assembles it, where feature payload
 * schemas are importable (a custom renderer zod-parses its own `n.data`). This is
 * the "core owns the envelope, not the kinds" seam (ADR 0001).
 */
export function dispatchNotification(
  n: Notification,
  renderers: NotificationRenderers = {},
) {
  const render = renderers[n.kind] ?? defaultToastRenderer;
  render(n);
}
