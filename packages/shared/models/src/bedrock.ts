import type { EmbeddingModelV3, LanguageModelV3 } from '@ai-sdk/provider';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

import type { BedrockChatConfig, BedrockEmbedConfig } from './model-schemas';

// Region + model ids arrive as the narrowed Bedrock variant (`config.chat` /
// `env.MODELS_EMBED`, @acme/env ADR 0001); credentials resolve via the standard AWS provider
// chain. These factories read no env — a Bedrock-active app's credentials are
// validated up front by `validateModelSecrets()` in `resolve.ts` (value axis).

// Mastra's model router has no native Bedrock entry, so we pass an
// `@ai-sdk/amazon-bedrock` provider instance directly.
export function bedrockChatModel(chat: BedrockChatConfig): LanguageModelV3 {
  return createAmazonBedrock({ region: chat.region })(chat.model);
}

// Cheaper model for thread-title generation. Falls back to the chat model when
// no title model is set, so titles work out of the box.
export function bedrockTitleModel(chat: BedrockChatConfig): LanguageModelV3 {
  return createAmazonBedrock({ region: chat.region })(
    chat.titleModel ?? chat.model,
  );
}

export function bedrockEmbedModel(embed: BedrockEmbedConfig): EmbeddingModelV3 {
  return createAmazonBedrock({ region: embed.region }).embedding(embed.model);
}
