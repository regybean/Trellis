import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

import { env } from './env';

// Single Bedrock provider instance. Mastra's model router has no native Bedrock
// provider, so we pass AI SDK provider instances directly to the agent and the
// embedding pipeline. Region comes from env; credentials resolve via the
// standard AWS provider chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / SSO).
export const bedrock = createAmazonBedrock({ region: env.AWS_REGION });

// Claude chat model used to generate assistant responses.
export const bedrockChat = bedrock(env.BEDROCK_CHAT_MODEL);

// Cohere English v3 embeddings (1024-dim) used for indexing and retrieval.
export const bedrockEmbed = bedrock.embedding('cohere.embed-english-v3');

// Cohere `input_type`, passed via `providerOptions.bedrock.inputType`. Cohere
// embeds documents and queries asymmetrically, so indexing uses `search_document`
// and retrieval uses `search_query`. (The AI SDK's `embeddingPurpose` option is
// Nova-only and ignored for Cohere models, so it must NOT be used here.)
export const INPUT_TYPE = {
  document: 'search_document',
  query: 'search_query',
} as const;
