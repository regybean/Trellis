import { z } from 'zod';

// The notification envelope — isomorphic (shipped via `./schema`), so both the
// server (`publish`) and the client (the toast renderers) validate against the
// one shape. This is the crux of the ADR (docs/adr/0030-notifications-seam.md):
// the core owns the ENVELOPE, never the kinds. `kind` is an OPEN string (a
// dispatch/telemetry key), not a closed enum — a closed discriminated union is
// impossible because `shared` cannot import feature payload types. `data` is an
// opaque escape hatch a custom renderer parses itself. A feature therefore adds
// a notification kind with zero change to this file.

// Toast severity. Maps 1:1 onto react-toastify's `toast.info|success|error` in
// the default renderer.
export const notificationLevelSchema = z.enum(['info', 'success', 'error']);
export type NotificationLevel = z.infer<typeof notificationLevelSchema>;

export const notificationSchema = z.object({
  // Server-minted (`randomUUID`). Distinct from the Redis stream entry id (which
  // the reader hands to tRPC `tracked()` as the SSE resume cursor): this id
  // rides in the payload and becomes the react-toastify `toastId`, so a
  // duplicate delivery (StrictMode double-mount, transient reconnect) collapses
  // to one visible toast.
  id: z.string(),
  // Open dispatch key. The app's `renderers` registry is keyed by it; an
  // unregistered kind falls through to the default toast renderer.
  kind: z.string(),
  level: notificationLevelSchema,
  message: z.string(),
  // ISO-8601, minted from the server clock in `publish`.
  createdAt: z.string(),
  // Opaque per-kind payload. The core never reads it; a custom renderer
  // zod-parses its own `data` at the top of the function.
  data: z.record(z.string(), z.unknown()).optional(),
});
export type Notification = z.infer<typeof notificationSchema>;

// The `publish` argument: the envelope minus the two fields the server mints
// (`id`, `createdAt`). A feature's typed one-line wrapper (e.g. ingest's
// `notifyJobComplete`) constructs this.
export const publishInputSchema = notificationSchema.omit({
  id: true,
  createdAt: true,
});
export type PublishInput = z.infer<typeof publishInputSchema>;
