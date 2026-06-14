// Root Mastra entrypoint for Studio (`pnpm studio` → `mastra dev`) and
// `pnpm lint:mastra` (`mastra lint`). The instance itself — chat agent,
// knowledge-base vector store and memory storage — is assembled in the chat
// feature; this just re-exports it so the Mastra CLI has a single project root.
export { mastra } from '@acme/chat/mastra';
