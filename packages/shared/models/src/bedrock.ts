import type { EmbeddingModelV3, LanguageModelV3 } from '@ai-sdk/provider';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

import type { BedrockChatConfig, BedrockEmbedConfig } from './config';
import { bedrockEnv } from './env-providers';

// Region + model ids arrive as the narrowed Bedrock variant (`config.chat` /
// `config.embed`, ADR 0026); credentials resolve via the standard AWS provider
// chain. `bedrockEnv()` is still called per model so a Bedrock-active app fails
// fast on missing credentials, not on the first request.

// Mastra's model router has no native Bedrock entry, so we pass an
// `@ai-sdk/amazon-bedrock` provider instance directly.
export function bedrockChatModel(chat: BedrockChatConfig): LanguageModelV3 {
  bedrockEnv();
  return createAmazonBedrock({ region: chat.region })(chat.model);
}

// Cheaper model for thread-title generation. Falls back to the chat model when
// no title model is set, so titles work out of the box.
export function bedrockTitleModel(chat: BedrockChatConfig): LanguageModelV3 {
  bedrockEnv();
  return createAmazonBedrock({ region: chat.region })(
    chat.titleModel ?? chat.model,
  );
}

export function bedrockEmbedModel(embed: BedrockEmbedConfig): EmbeddingModelV3 {
  bedrockEnv();
  return createAmazonBedrock({ region: embed.region }).embedding(embed.model);
}
