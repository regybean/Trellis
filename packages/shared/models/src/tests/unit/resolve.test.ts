import { describe, expect, it } from 'vitest';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

import {
  chatConfigSchema,
  embedConfigSchema,
  modelsConfig,
} from '../../config';
import {
  embedProviderOptionsFor,
  resolveChatModel,
  resolveEmbedModel,
  resolveTitleModel,
} from '../../resolve';

/**
 * Domain (pure) tests for the @acme/models provider resolver + config. No
 * network, no mocks — the ai-sdk factories only build config objects at import.
 * `modelsConfig` is exercised through an injected `ConfigContext` (ADR 0026); its
 * base (development) profile selects Ollama for both roles: `chat.model` =
 * 'qwen2.5:1.5b', `embed.model` = 'nomic-embed-text', `embed.dimensions` = 768,
 * no title model. The resolvers take the narrowed variant (`config.chat` /
 * `config.embed`), so a variant built here drives them directly. Bedrock and
 * OpenRouter need credentials at construction (secrets, absent in the test
 * matrix), so their opaque model instances are not built here; each is exercised
 * through the surface observable without its credentials — the
 * `embedProviderOptions` matrix and the schema-level parse rejections.
 */

const dev: ConfigContext = { appEnv: 'development', isServer: true };

describe('modelsConfig — per-role discriminated unions', () => {
  it('selects the ollama chat + embed variants in the development profile', () => {
    const config = modelsConfig(dev);
    expect(config.chat).toEqual({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5:1.5b',
    });
    expect(config.embed).toEqual({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
  });

  it('rejects an OpenRouter embed selection at parse time (no embeddings API)', () => {
    const result = embedConfigSchema.safeParse({
      provider: 'openrouter',
      model: 'openai/text-embedding-3-small',
      dimensions: 1536,
    });
    expect(result.success).toBe(false);
  });

  it('validates only the selected provider fields — ollama needs no region', () => {
    // A bedrock-only field is neither required nor accepted on the ollama variant:
    // present-but-unknown keys are stripped, and the absence of `region` is fine.
    const parsed = chatConfigSchema.parse({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5:1.5b',
      region: 'eu-west-2',
    });
    expect(parsed).not.toHaveProperty('region');
  });
});

// A representative config mirroring the models `chat` union: development selects
// ollama, a production overlay flips to bedrock. Proves the profile overlay can
// flip provider and merge cleanly — deep-merge carries the ollama-only `baseUrl`
// into the merged object, and the discriminated union strips it (zod object-strip)
// when the bedrock variant validates.
function flipConfig(context: ConfigContext) {
  return createConfig({
    server: { chat: chatConfigSchema },
    profiles: {
      default: {
        server: {
          chat: {
            provider: 'ollama',
            baseUrl: 'http://localhost:11434/v1',
            model: 'qwen2.5:1.5b',
          },
        },
      },
      production: {
        server: {
          chat: {
            provider: 'bedrock',
            region: 'eu-west-2',
            model: 'eu.anthropic.claude-3-7-sonnet-20250219-v1:0',
          },
        },
      },
    },
    context,
  });
}

describe('profile overlay flipping provider', () => {
  it('flips ollama → bedrock and strips the ollama-only baseUrl on merge', () => {
    const config = flipConfig({ appEnv: 'production', isServer: true });
    expect(config.chat).toEqual({
      provider: 'bedrock',
      region: 'eu-west-2',
      model: 'eu.anthropic.claude-3-7-sonnet-20250219-v1:0',
    });
    expect(config.chat).not.toHaveProperty('baseUrl');
  });

  it('keeps the base ollama variant when no overlay applies', () => {
    const config = flipConfig(dev);
    expect(config.chat.provider).toBe('ollama');
  });
});

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
  it('resolves the config-selected ollama embed model', () => {
    const model = resolveEmbedModel(modelsConfig(dev).embed);
    expect(model.provider).toContain('ollama');
    expect(model.modelId).toBe('nomic-embed-text');
  });
});

describe('resolveChatModel / resolveTitleModel', () => {
  it('resolves the ollama chat model', () => {
    const model = resolveChatModel(modelsConfig(dev).chat);
    expect(model.provider).toContain('ollama');
    expect(model.modelId).toBe('qwen2.5:1.5b');
  });

  it('falls the title model back to the chat model when no title model is set', () => {
    // No title model in the base profile, so the title model reuses the chat
    // model id — the fallback each provider factory promises.
    expect(resolveTitleModel(modelsConfig(dev).chat).modelId).toBe(
      'qwen2.5:1.5b',
    );
  });
});
