import { Memory } from '@mastra/memory';

import { titleModel } from '@acme/models';

import { env } from './env';
import { postgresStore } from './storage';

// Semantic recall is off by default, so no vector store or embedder is needed
// here.
export const memory = new Memory({
  storage: postgresStore,
  vector: false,
  options: {
    lastMessages: env.MEMORY_LAST_MESSAGES,
    semanticRecall: env.MEMORY_SEMANTIC_RECALL,
    // Auto-name threads from the first user message so the conversation-history
    // sidebar shows meaningful titles instead of "New conversation". Runs
    // asynchronously after the turn, so it adds no latency to the response.
    generateTitle: {
      model: titleModel,
      instructions: `Generate a concise, descriptive title (max ${env.MEMORY_TITLE_WORD_CAP} words) for this conversation based on the first user message. Use plain text with no quotes or trailing punctuation.`,
    },
  },
});
