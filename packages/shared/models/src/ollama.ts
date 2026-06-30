import type { EmbeddingModelV3, LanguageModelV3 } from '@ai-sdk/provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { ollamaEnv } from './env';

// Ollama speaks the OpenAI-compatible API on `/v1`, which covers both chat and
// embeddings, so one provider instance serves both. Dev/test default: tiny
// CPU-only models, no GPU assumed.
function ollamaProvider() {
  const env = ollamaEnv();
  return createOpenAICompatible({
    name: 'ollama',
    baseURL: env.OLLAMA_BASE_URL,
  });
}

export function ollamaChatModel(): LanguageModelV3 {
  return ollamaProvider().chatModel(ollamaEnv().OLLAMA_CHAT_MODEL);
}

// Cheaper model for thread-title generation. Falls back to the chat model when
// OLLAMA_TITLE_MODEL is unset.
export function ollamaTitleModel(): LanguageModelV3 {
  const env = ollamaEnv();
  return ollamaProvider().chatModel(
    env.OLLAMA_TITLE_MODEL ?? env.OLLAMA_CHAT_MODEL,
  );
}

export function ollamaEmbedModel(): EmbeddingModelV3 {
  return ollamaProvider().embeddingModel(ollamaEnv().OLLAMA_EMBED_MODEL);
}
