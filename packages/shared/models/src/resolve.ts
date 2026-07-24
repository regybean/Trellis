import type { SharedV3ProviderOptions } from '@ai-sdk/provider';

import {
  bedrockChatModel,
  bedrockEmbedModel,
  bedrockTitleModel,
} from './bedrock';
import { modelsEnv } from './env';
import { ollamaChatModel, ollamaEmbedModel, ollamaTitleModel } from './ollama';
import { openrouterChatModel, openrouterTitleModel } from './openrouter';

// Provider identifiers, derived from the public env schema so the resolver's
// switch and the env parser can never drift. `EmbedProvider` is the narrower set
// (OpenRouter has no embeddings API); the embed resolver still accepts the full
// `LlmProvider` set so an invalid selection is rejected here with a clear message
// rather than being unrepresentable.
type ModelsEnv = ReturnType<typeof modelsEnv>;
type LlmProvider = ModelsEnv['LLM_PROVIDER'];
type EmbedProvider = ModelsEnv['EMBED_PROVIDER'];

// --- Pure core: provider-parameterised resolvers reading NO module-scope env ---
//
// Each resolver takes the provider explicitly and dispatches to that provider's
// factory. Only the chosen factory runs, so only its env is validated (the
// per-provider `createEnv` calls live inside the factories — see
// `env-providers.ts`). Chat and embed providers are resolved independently — e.g.
// OpenRouter chat + Ollama embed is a valid combination.
//
// The title model follows the chat provider (same family, optionally a cheaper
// model id); each factory falls back to the chat model when no title env is set.
export function resolveChatModel(provider: LlmProvider) {
  switch (provider) {
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

export function resolveTitleModel(provider: LlmProvider) {
  switch (provider) {
    case 'bedrock': {
      return bedrockTitleModel();
    }
    case 'openrouter': {
      return openrouterTitleModel();
    }
    case 'ollama': {
      return ollamaTitleModel();
    }
  }
}

// Accepts the full provider set so an invalid embed selection surfaces as a
// clear domain error here, not an unrepresentable state. OpenRouter exposes no
// embeddings API, so it is rejected; `EMBED_PROVIDER` already excludes it at
// parse time, so the eager cap below never reaches this branch.
export function resolveEmbedModel(provider: LlmProvider) {
  switch (provider) {
    case 'bedrock': {
      return bedrockEmbedModel();
    }
    case 'ollama': {
      return ollamaEmbedModel();
    }
    case 'openrouter': {
      throw new Error(
        'OpenRouter exposes no embeddings API; EMBED_PROVIDER must be "bedrock" or "ollama".',
      );
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
// The active providers are constructed once at import and a missing/invalid env
// for an active provider blocks here (as the env.ts files do) rather than failing
// deep inside a request. This eager-at-import behaviour is deliberately retained
// (ADR 0014 / ADR 0024): the build and test infra rely on it.
const env = modelsEnv();

export const chatModel = resolveChatModel(env.LLM_PROVIDER);
export const titleModel = resolveTitleModel(env.LLM_PROVIDER);
export const embedModel = resolveEmbedModel(env.EMBED_PROVIDER);

// Thin cap over `embedProviderOptionsFor`, binding the env-selected embed
// provider. Callers pass the result straight to `embedMany` / the vector query
// tool without knowing which provider is active.
export function embedProviderOptions(purpose: 'document' | 'query') {
  return embedProviderOptionsFor(env.EMBED_PROVIDER, purpose);
}
