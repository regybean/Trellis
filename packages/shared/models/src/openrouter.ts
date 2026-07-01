import type { LanguageModelV3 } from '@ai-sdk/provider';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import { openrouterEnv } from './env';

// OpenRouter chat model. Chat only — OpenRouter exposes no embeddings API, so it
// is not selectable as EMBED_PROVIDER.
export function openrouterChatModel(): LanguageModelV3 {
  const env = openrouterEnv();
  return createOpenRouter({ apiKey: env.OPENROUTER_API_KEY }).chat(
    env.OPENROUTER_CHAT_MODEL,
  );
}

// Cheaper model for thread-title generation. Falls back to the chat model when
// OPENROUTER_TITLE_MODEL is unset.
export function openrouterTitleModel(): LanguageModelV3 {
  const env = openrouterEnv();
  return createOpenRouter({ apiKey: env.OPENROUTER_API_KEY }).chat(
    env.OPENROUTER_TITLE_MODEL ?? env.OPENROUTER_CHAT_MODEL,
  );
}
