import type { SharedV3ProviderOptions } from '@ai-sdk/provider';

import { bedrockChatModel, bedrockEmbedModel } from './bedrock';
import { modelsEnv } from './env';
import { ollamaChatModel, ollamaEmbedModel } from './ollama';
import { openrouterChatModel } from './openrouter';

const env = modelsEnv();

// Chat and embed providers are resolved independently — e.g. OpenRouter chat +
// Ollama embed is a valid combination. Only the selected provider's factory runs
// (and so only its envs are validated); the others are never invoked.
function resolveChatModel() {
  switch (env.LLM_PROVIDER) {
    case 'bedrock': {
      return bedrockChatModel();
    }
    case 'openrouter': {
      return openrouterChatModel();
    }
    case 'ollama': {
      return ollamaChatModel();
    }
  }
}

function resolveEmbedModel() {
  switch (env.EMBED_PROVIDER) {
    case 'bedrock': {
      return bedrockEmbedModel();
    }
    case 'ollama': {
      return ollamaEmbedModel();
    }
  }
}

// Eagerly resolved at import: the active providers are constructed once, and a
// missing/invalid env for an active provider blocks here (as the existing env.ts
// files do) rather than failing deep inside a request.
export const chatModel = resolveChatModel();
export const embedModel = resolveEmbedModel();

// Provider options for an embed call, keyed by purpose. Bedrock's Cohere model
// embeds documents and queries asymmetrically via `inputType`; Ollama needs no
// options. Callers pass the result straight to `embedMany` / the vector query
// tool without knowing which provider is active.
export function embedProviderOptions(purpose: 'document' | 'query') {
  const options: SharedV3ProviderOptions = {};
  if (env.EMBED_PROVIDER === 'bedrock') {
    options.bedrock = {
      inputType: purpose === 'document' ? 'search_document' : 'search_query',
    };
  }
  return options;
}
