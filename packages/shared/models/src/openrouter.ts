import type { LanguageModelV3 } from '@ai-sdk/provider';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import { modelsConfig } from './config';
import { appEnv } from './env';
import { openrouterEnv } from './env-providers';

// Model ids are config-as-code (ADR 0026); the API key is a secret read from env.
const config = modelsConfig({ appEnv, isServer: true });

// OpenRouter chat model. Chat only — OpenRouter exposes no embeddings API, so it
// is not selectable as EMBED_PROVIDER.
export function openrouterChatModel(): LanguageModelV3 {
  const env = openrouterEnv();
  return createOpenRouter({ apiKey: env.OPENROUTER_API_KEY }).chat(
    config.OPENROUTER_CHAT_MODEL,
  );
}

// Cheaper model for thread-title generation. Falls back to the chat model when
// OPENROUTER_TITLE_MODEL is unset.
export function openrouterTitleModel(): LanguageModelV3 {
  const env = openrouterEnv();
  return createOpenRouter({ apiKey: env.OPENROUTER_API_KEY }).chat(
    config.OPENROUTER_TITLE_MODEL ?? config.OPENROUTER_CHAT_MODEL,
  );
}
