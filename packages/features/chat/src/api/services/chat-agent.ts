import { Agent } from '@mastra/core/agent';
import { createVectorQueryTool } from '@mastra/rag';

import {
  bedrockChat,
  bedrockEmbed,
  indexName,
  INPUT_TYPE,
  memory,
  pgVector,
} from '@acme/rag';

import { getAppInfo } from '../../data/app-info';
import { env } from '../../env';

// Retrieval over the knowledge base. The agent calls this tool to ground its
// answers; the query is embedded with Cohere using the `search_query` input type.
const vectorQueryTool = createVectorQueryTool({
  vectorStore: pgVector,
  indexName,
  model: bedrockEmbed,
  providerOptions: {
    bedrock: { inputType: INPUT_TYPE.query },
  },
});

// The RAG chat assistant. Conversation history (last 15 turns) comes from Mastra
// Memory; relevant Documents come from the vector query tool.
export const chatAgent: Agent = new Agent({
  id: 'chat',
  name: 'chat',
  instructions: getAppInfo(env.NEXT_PUBLIC_WEBAPP).systemPrompt,
  model: bedrockChat,
  tools: { vectorQuery: vectorQueryTool },
  memory,
});
