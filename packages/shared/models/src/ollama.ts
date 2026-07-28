import type { EmbeddingModelV3, LanguageModelV3 } from '@ai-sdk/provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import type { OllamaChatConfig, OllamaEmbedConfig } from './config';

// Base URL + model ids arrive as the narrowed Ollama variant (`config.chat` /
// `config.embed`, ADR 0026); Ollama has no secret, so these factories read
// nothing from env. Ollama speaks the OpenAI-compatible API on `/v1`, which
// covers both chat and embeddings, so one provider instance serves both. Dev/test
// default: tiny CPU-only models, no GPU assumed.
function ollamaProvider(baseUrl: string) {
  return createOpenAICompatible({ name: 'ollama', baseURL: baseUrl });
}

export function ollamaChatModel(chat: OllamaChatConfig): LanguageModelV3 {
  return ollamaProvider(chat.baseUrl).chatModel(chat.model);
}

// Cheaper model for thread-title generation. Falls back to the chat model when
// no title model is set.
export function ollamaTitleModel(chat: OllamaChatConfig): LanguageModelV3 {
  return ollamaProvider(chat.baseUrl).chatModel(chat.titleModel ?? chat.model);
}

export function ollamaEmbedModel(embed: OllamaEmbedConfig): EmbeddingModelV3 {
  return ollamaProvider(embed.baseUrl).embeddingModel(embed.model);
}
