import { Agent } from '@mastra/core/agent';
import { createVectorQueryTool } from '@mastra/rag';

import { chatModel, embedModel, embedProviderOptions } from '@acme/models';
import { indexName, memory, pgVector } from '@acme/rag';

import { getAppInfo } from '../../data/app-info';
import { env } from '../../env';

// Retrieval over the knowledge base. The agent calls this tool to ground its
// answers; the query is embedded by the active embed provider, with any
// provider-specific options (e.g. Cohere's `search_query` input type) applied.
const vectorQueryTool = createVectorQueryTool({
  vectorStore: pgVector,
  indexName,
  model: embedModel,
  providerOptions: embedProviderOptions('query'),
});

// The RAG chat assistant. Conversation history (last 15 turns) comes from Mastra
// Memory; relevant Documents come from the vector query tool.
export const chatAgent: Agent = new Agent({
  id: 'chat',
  name: 'chat',
  instructions: getAppInfo(env.NEXT_PUBLIC_WEBAPP).systemPrompt,
  model: chatModel,
  tools: { vectorQuery: vectorQueryTool },
  memory,
});
