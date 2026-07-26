import { describe, expect, it } from 'vitest';

import {
  embedProviderOptionsFor,
  resolveChatModel,
  resolveEmbedModel,
  resolveTitleModel,
} from '../../resolve';

/**
 * Domain (pure) tests for the @acme/models provider resolver. No network, no
 * mocks — the ai-sdk factories only build config objects at import, and env is
 * the real `staticTestEnv` (ADR 0014): `LLM_PROVIDER`/`EMBED_PROVIDER` = ollama,
 * `OLLAMA_CHAT_MODEL` = 'test-chat', `OLLAMA_EMBED_MODEL` = 'test-embed', no
 * title model set. Bedrock and OpenRouter carry no env in the test matrix, so
 * their opaque model instances are not constructed here; each provider is
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

  it('resolves the env-selected ollama embed model', () => {
    const model = resolveEmbedModel('ollama');
    expect(model.provider).toContain('ollama');
    expect(model.modelId).toBe('test-embed');
  });
});

describe('resolveChatModel / resolveTitleModel', () => {
  it('resolves the ollama chat model', () => {
    const model = resolveChatModel('ollama');
    expect(model.provider).toContain('ollama');
    expect(model.modelId).toBe('test-chat');
  });

  it('falls the title model back to the chat model when no title env is set', () => {
    // OLLAMA_TITLE_MODEL is unset in the test env, so the title model reuses the
    // chat model id — the fallback each provider factory promises.
    expect(resolveTitleModel('ollama').modelId).toBe('test-chat');
  });
});
