import { Mastra } from '@mastra/core/mastra';

import { pgVector, postgresStore } from '@acme/rag';

import { chatAgent } from '../api/services/chat-agent';

// Central Mastra instance registering the chat agent, knowledge-base vector
// store and memory storage. Consumed by the root `mastra dev` / `mastra lint`
// entrypoint for Studio; the runtime agent is used directly by the chat router.
//
// Runtime note: `@acme/rag` carries `import 'server-only'`, which throws outside
// an RSC bundle — so the `studio` script runs `mastra dev` with
// `--conditions=react-server` (via NODE_OPTIONS) to resolve it to its empty
// stub, the same idiom each app's `dev:worker` uses for `@acme/chat/server`.
// `mastra lint` only bundles this entry, so it needs no condition.
//
// Preset note: `chatAgent` declares a `requestContextSchema`, and Mastra
// validates it before any LLM call — so Studio cannot run this agent without a
// valid retrieval context. The `studio` script therefore passes
// `--request-context-presets ./presets.json`, which carries BOTH keys the
// schema requires (`filter` and `topK`). Its owner is deliberately fake and its
// `$in` list empty, so **Studio retrieves nothing**: it exercises the prompt and
// the model, not the corpus. To retrieve for real, point the preset at a real
// owner id and real Data Source ids — do not relax the schema.
export const mastra: Mastra = new Mastra({
  agents: { chat: chatAgent },
  vectors: { pgVector },
  storage: postgresStore,
});
