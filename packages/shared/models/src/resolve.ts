import type { SharedV3ProviderOptions } from '@ai-sdk/provider';

import type { ChatConfig, EmbedConfig } from './model-schemas';
import {
  bedrockChatModel,
  bedrockEmbedModel,
  bedrockTitleModel,
} from './bedrock';
import { env, validateModelSecrets } from './env';
import { ollamaChatModel, ollamaEmbedModel, ollamaTitleModel } from './ollama';
import { openrouterChatModel, openrouterTitleModel } from './openrouter';

// The embed provider set, derived from the embed union's discriminant so the
// options matrix can never drift from the schema. OpenRouter is absent — it
// exposes no embeddings API — so no-embed is unrepresentable here.
type EmbedProvider = EmbedConfig['provider'];

// --- Pure core: variant-parameterised resolvers reading NO module-scope env ---
//
// Each resolver takes the narrowed variant (`env.MODELS_CHAT` / `env.MODELS_EMBED`)
// and dispatches on its `provider` discriminant to that provider's factory. The
// active providers' secrets are validated once up front by `validateModelSecrets()` below
// (ADR 0033, value axis), so the factories only build model instances — they
// read no env. The variant carries exactly the chosen provider's fields — no
// region on Ollama, no base URL on Bedrock — so the factories need no
// cross-provider guards. Chat and embed are resolved independently — e.g.
// OpenRouter chat + Ollama embed is valid.
//
// The title model follows the chat provider (same family, optionally a cheaper
// model id); each factory falls back to the chat model when no title id is set.
export function resolveChatModel(chat: ChatConfig) {
  switch (chat.provider) {
    case 'bedrock': {
      return bedrockChatModel(chat);
    }
    case 'openrouter': {
      return openrouterChatModel(chat);
    }
    case 'ollama': {
      return ollamaChatModel(chat);
    }
  }
}

export function resolveTitleModel(chat: ChatConfig) {
  switch (chat.provider) {
    case 'bedrock': {
      return bedrockTitleModel(chat);
    }
    case 'openrouter': {
      return openrouterTitleModel(chat);
    }
    case 'ollama': {
      return ollamaTitleModel(chat);
    }
  }
}

// Total over the embed union: OpenRouter is absent from it (no embeddings API),
// so there is no invalid case to reject at runtime — the schema rejects an
// OpenRouter embed selection at parse time.
export function resolveEmbedModel(embed: EmbedConfig) {
  switch (embed.provider) {
    case 'bedrock': {
      return bedrockEmbedModel(embed);
    }
    case 'ollama': {
      return ollamaEmbedModel(embed);
    }
  }
}

// Provider options for an embed call, keyed by provider and purpose. Bedrock's
// Cohere model embeds documents and queries asymmetrically via `inputType`;
// Ollama needs no options. Pure — reads no env, so the whole matrix is
// table-testable across providers.
export function embedProviderOptionsFor(
  provider: EmbedProvider,
  purpose: 'document' | 'query',
) {
  const options: SharedV3ProviderOptions = {};
  if (provider === 'bedrock') {
    options.bedrock = {
      inputType: purpose === 'document' ? 'search_document' : 'search_query',
    };
  }
  return options;
}

// --- Eager singletons: thin caps binding the env-selected provider ---
//
// The active providers are constructed once at import and a missing/invalid
// selection for an active provider blocks here rather than failing deep inside a
// request. This eager-at-import behaviour is deliberately retained (ADR 0014 /
// ADR 0024): the build and test infra rely on it.
//
// Fail fast at import on missing credentials for whichever providers the resolved
// selection needs (value axis), instead of failing deep inside the first request.
validateModelSecrets();

export const chatModel = resolveChatModel(env.MODELS_CHAT);
export const titleModel = resolveTitleModel(env.MODELS_CHAT);
export const embedModel = resolveEmbedModel(env.MODELS_EMBED);

// Thin cap over `embedProviderOptionsFor`, binding the config-selected embed
// provider. Callers pass the result straight to `embedMany` / the vector query
// tool without knowing which provider is active.
export function embedProviderOptions(purpose: 'document' | 'query') {
  return embedProviderOptionsFor(env.MODELS_EMBED.provider, purpose);
}
