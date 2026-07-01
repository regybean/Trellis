import type { EmbeddingModelV3, LanguageModelV3 } from '@ai-sdk/provider';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

import { bedrockEnv } from './env';

// Mastra's model router has no native Bedrock entry, so we pass an
// `@ai-sdk/amazon-bedrock` provider instance directly. Region from env;
// credentials resolve via the standard AWS provider chain.
export function bedrockChatModel(): LanguageModelV3 {
  const env = bedrockEnv();
  return createAmazonBedrock({ region: env.AWS_REGION })(
    env.BEDROCK_CHAT_MODEL,
  );
}

// Cheaper model for thread-title generation. Falls back to the chat model when
// BEDROCK_TITLE_MODEL is unset, so titles work out of the box.
export function bedrockTitleModel(): LanguageModelV3 {
  const env = bedrockEnv();
  return createAmazonBedrock({ region: env.AWS_REGION })(
    env.BEDROCK_TITLE_MODEL ?? env.BEDROCK_CHAT_MODEL,
  );
}

export function bedrockEmbedModel(): EmbeddingModelV3 {
  const env = bedrockEnv();
  return createAmazonBedrock({ region: env.AWS_REGION }).embedding(
    env.BEDROCK_EMBED_MODEL,
  );
}
