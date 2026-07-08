// Shared app-owned Drizzle schema for the microservices showcase. drizzle-kit
// (push) manages only what's exported here, under the one deployment schema.
//
// The Mastra Memory tables (`mastra_*`) are intentionally NOT exported — Mastra
// owns their DDL at runtime (ADR 0002), and the `!mastra_*` tablesFilter in
// drizzle.push.config.ts stops push from dropping them.
//
// Each feature table already binds itself to `pgSchema(NEXT_PUBLIC_WEBAPP)`
// internally, so re-exporting them here is enough to place them in the shared
// deployment namespace. ingest has no app-owned table.
export { appSchema } from './app-schema';
export { chatFolder } from '@acme/chat/schema';
export { messageFeedback, feedbackRating } from '@acme/feedback/schema';
