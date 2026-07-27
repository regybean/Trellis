import type { EmbeddingModelV3, LanguageModelV3 } from '@ai-sdk/provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { modelsConfig } from './config';
import { appEnv } from './env';

// Base URL + model ids are config-as-code (ADR 0026); Ollama has no secret, so it
// reads nothing from env. Ollama speaks the OpenAI-compatible API on `/v1`, which
// covers both chat and embeddings, so one provider instance serves both. Dev/test
// default: tiny CPU-only models, no GPU assumed.
const config = modelsConfig({ appEnv, isServer: true });

function ollamaProvider() {
  return createOpenAICompatible({
    name: 'ollama',
    baseURL: config.OLLAMA_BASE_URL,
  });
}

export function ollamaChatModel(): LanguageModelV3 {
  return ollamaProvider().chatModel(config.OLLAMA_CHAT_MODEL);
}

// Cheaper model for thread-title generation. Falls back to the chat model when
// OLLAMA_TITLE_MODEL is unset.
export function ollamaTitleModel(): LanguageModelV3 {
  return ollamaProvider().chatModel(
    config.OLLAMA_TITLE_MODEL ?? config.OLLAMA_CHAT_MODEL,
  );
}

export function ollamaEmbedModel(): EmbeddingModelV3 {
  return ollamaProvider().embeddingModel(config.OLLAMA_EMBED_MODEL);
}
