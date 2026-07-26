import type { EmbeddingModelV3, LanguageModelV3 } from '@ai-sdk/provider';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

import { modelsConfig } from './config';
import { appEnv } from './env';
import { bedrockEnv } from './env-providers';

// Region + model ids are config-as-code (ADR 0026); credentials resolve via the
// standard AWS provider chain. `bedrockEnv()` is still called per model so a
// Bedrock-active app fails fast on missing credentials, not on the first request.
const config = modelsConfig({ appEnv, isServer: true });

// Mastra's model router has no native Bedrock entry, so we pass an
// `@ai-sdk/amazon-bedrock` provider instance directly.
export function bedrockChatModel(): LanguageModelV3 {
  bedrockEnv();
  return createAmazonBedrock({ region: config.AWS_REGION })(
    config.BEDROCK_CHAT_MODEL,
  );
}

// Cheaper model for thread-title generation. Falls back to the chat model when
// BEDROCK_TITLE_MODEL is unset, so titles work out of the box.
export function bedrockTitleModel(): LanguageModelV3 {
  bedrockEnv();
  return createAmazonBedrock({ region: config.AWS_REGION })(
    config.BEDROCK_TITLE_MODEL ?? config.BEDROCK_CHAT_MODEL,
  );
}

export function bedrockEmbedModel(): EmbeddingModelV3 {
  bedrockEnv();
  return createAmazonBedrock({ region: config.AWS_REGION }).embedding(
    config.BEDROCK_EMBED_MODEL,
  );
}
