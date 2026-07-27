import { describe, expect, it } from 'vitest';

import {
  embedProviderOptionsFor,
  resolveChatModel,
  resolveEmbedModel,
  resolveTitleModel,
} from '../../resolve';

/**
 * Domain (pure) tests for the @acme/models provider resolver. No network, no
 * mocks — the ai-sdk factories only build config objects at import. Model ids are
 * config-as-code now (ADR 0026): `modelsConfig`'s base (development) profile sets
 * `LLM_PROVIDER`/`EMBED_PROVIDER` = ollama, `OLLAMA_CHAT_MODEL` = 'qwen2.5:1.5b',
 * `OLLAMA_EMBED_MODEL` = 'nomic-embed-text', no title model. Bedrock and
 * OpenRouter need only credentials at construction (secrets, absent in the test
 * matrix), so their opaque model instances are not built here; each provider is
 * instead exercised through the surface observable without its credentials — the
 * `embedProviderOptions` matrix (all embed providers) and the invalid-embed
 * rejection — asserting the pure outputs, not the AI-SDK instances.
 */

describe('embedProviderOptionsFor', () => {
  it.each([
    ['bedrock', 'document', { bedrock: { inputType: 'search_document' } }],
    ['bedrock', 'query', { bedrock: { inputType: 'search_query' } }],
    ['ollama', 'document', {}],
    ['ollama', 'query', {}],
  ] as const)(
    'maps %s / %s to its provider options',
    (provider, purpose, expected) => {
      expect(embedProviderOptionsFor(provider, purpose)).toEqual(expected);
    },
  );
});

describe('resolveEmbedModel', () => {
  it('rejects openrouter — it exposes no embeddings API', () => {
    expect(() => resolveEmbedModel('openrouter')).toThrow(/embeddings/i);
  });

  it('resolves the config-selected ollama embed model', () => {
    const model = resolveEmbedModel('ollama');
    expect(model.provider).toContain('ollama');
    expect(model.modelId).toBe('nomic-embed-text');
  });
});

describe('resolveChatModel / resolveTitleModel', () => {
  it('resolves the ollama chat model', () => {
    const model = resolveChatModel('ollama');
    expect(model.provider).toContain('ollama');
    expect(model.modelId).toBe('qwen2.5:1.5b');
  });

  it('falls the title model back to the chat model when no title model is set', () => {
    // OLLAMA_TITLE_MODEL is unset in the base profile, so the title model reuses
    // the chat model id — the fallback each provider factory promises.
    expect(resolveTitleModel('ollama').modelId).toBe('qwen2.5:1.5b');
  });
});
