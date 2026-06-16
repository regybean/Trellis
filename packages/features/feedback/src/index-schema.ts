// Database schema exports — safe to import in any context (CLI, server, client
// build). Intentionally has NO `server-only` guard so drizzle-kit can load it.
// `message_feedback` is the first app-owned, drizzle-kit-managed table; the app
// re-exports it through its own db/schema.ts so push/generate manage its DDL.
export {
  messageFeedback,
  feedbackRating,
  selectFeedbackSchema,
} from './api/schemas/feedback-schema';
export type { SelectFeedbackSchema } from './api/schemas/feedback-schema';
