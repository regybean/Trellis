import type { LanguageModelV3 } from '@ai-sdk/provider';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import type { OpenRouterChatConfig } from './config';
import { openrouterEnv } from './env-providers';

// Model ids arrive as the narrowed OpenRouter variant (`config.chat`, ADR 0026);
// the API key is a secret read from env. Chat only — OpenRouter exposes no
// embeddings API, so it is absent from the embed union.
export function openrouterChatModel(
  chat: OpenRouterChatConfig,
): LanguageModelV3 {
  const env = openrouterEnv();
  return createOpenRouter({ apiKey: env.OPENROUTER_API_KEY }).chat(chat.model);
}

// Cheaper model for thread-title generation. Falls back to the chat model when
// no title model is set.
export function openrouterTitleModel(
  chat: OpenRouterChatConfig,
): LanguageModelV3 {
  const env = openrouterEnv();
  return createOpenRouter({ apiKey: env.OPENROUTER_API_KEY }).chat(
    chat.titleModel ?? chat.model,
  );
}
