// Export schema so that drizzle works properly with migrations.
// Conversations/messages are persisted by Mastra Memory; the app DB hosts the
// Mastra Memory tables (mirrored as drizzle schemas in @acme/rag).
export {
  mastraThreads,
  mastraMessages,
  mastraResources,
} from '@acme/rag/schema';
