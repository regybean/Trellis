import type { EmbeddingModelV3, LanguageModelV3 } from '@ai-sdk/provider';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

import { bedrockEnv } from './env';

// Cohere English v3 embeddings (1024-dim). When EMBED_PROVIDER=bedrock, set
// EMBED_DIMENSIONS=1024 to match — the index guard in @acme/rag enforces it.
const BEDROCK_EMBED_MODEL = 'cohere.embed-english-v3';

// Mastra's model router has no native Bedrock entry, so we pass an
// `@ai-sdk/amazon-bedrock` provider instance directly. Region from env;
// credentials resolve via the standard AWS provider chain.
export function bedrockChatModel(): LanguageModelV3 {
  const env = bedrockEnv();
  return createAmazonBedrock({ region: env.AWS_REGION })(
    env.BEDROCK_CHAT_MODEL,
  );
}

export function bedrockEmbedModel(): EmbeddingModelV3 {
  const env = bedrockEnv();
  return createAmazonBedrock({ region: env.AWS_REGION }).embedding(
    BEDROCK_EMBED_MODEL,
  );
}
