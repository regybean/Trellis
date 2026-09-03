import { toast } from 'react-toastify';

import type { Notification } from './api/schemas/notification-schema';

// react-toastify severity fns, indexed by envelope `level`. A closed record over
// the schema enum, so a new level fails to compile here until it's handled.
const LEVEL_TO_TOAST = {
  info: toast.info,
  success: toast.success,
  error: toast.error,
} as const;

/**
 * The fallback renderer for any `kind` the app hasn't registered. Maps
 * `level`→`toast.info|success|error`, renders the plain `message`, and passes
 * `toastId: n.id` so react-toastify collapses a duplicate delivery (StrictMode
 * double-mount, transient reconnect) to a single visible toast — the deferred
 * dedup from the delivery design, resolved at the transport level with zero
 * client state (ADR 0001). It renders into whatever `<ToastContainer/>` the app
 * already mounts (`<ToastThemeClient/>`); the provider adds none.
 */
export function defaultToastRenderer(n: Notification) {
  LEVEL_TO_TOAST[n.level](n.message, { toastId: n.id });
}
