import type { LanguageModelV3 } from '@ai-sdk/provider';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import type { OpenRouterChatConfig } from './model-schemas';

// Model ids arrive as the narrowed OpenRouter variant (`env.MODELS_CHAT`, ADR 0033).
// The API key is a secret validated up front by `validateModelSecrets()` in
// `resolve.ts` (value axis); `createOpenRouter` then reads `OPENROUTER_API_KEY`
// implicitly from `process.env` at request time, so these factories read no env.
// Chat only — OpenRouter exposes no embeddings API, so it is absent from the
// embed union.
export function openrouterChatModel(
  chat: OpenRouterChatConfig,
): LanguageModelV3 {
  return createOpenRouter().chat(chat.model);
}

// Cheaper model for thread-title generation. Falls back to the chat model when
// no title model is set.
export function openrouterTitleModel(
  chat: OpenRouterChatConfig,
): LanguageModelV3 {
  return createOpenRouter().chat(chat.titleModel ?? chat.model);
}
