import { createEnv } from '@t3-oss/env-core';
import { describe, expect, it } from 'vitest';

import type { AppEnv } from '@acme/env';
import { jsonEnv, withProfiles } from '@acme/env';

import { env } from '../../env';
import { chatConfigSchema, embedConfigSchema } from '../../model-schemas';
import {
  embedProviderOptionsFor,
  resolveChatModel,
  resolveEmbedModel,
  resolveTitleModel,
} from '../../resolve';

/**
 * Domain (pure) tests for the @acme/models provider resolver + selection schemas.
 * No network, no mocks — the ai-sdk factories only build config objects at
 * import. Under vitest `APP_ENV=development` (`staticTestEnv`), so this slice's
 * `env` resolves its base profile: Ollama for both roles, `MODELS_CHAT.model` =
 * 'qwen2.5:1.5b', `MODELS_EMBED.model` = 'nomic-embed-text',
 * `MODELS_EMBED.dimensions` = 768, no title model. The resolvers take the
 * narrowed variant, so a variant built here drives them directly. Bedrock and
 * OpenRouter need credentials at construction (secrets, absent in the test
 * matrix), so their opaque model instances are not built here; each is exercised
 * through the surface observable without its credentials — the
 * `embedProviderOptions` matrix and the schema-level parse rejections.
 */

describe('models env — per-role discriminated unions', () => {
  it('selects the ollama chat + embed variants in the development profile', () => {
    expect(env.MODELS_CHAT).toEqual({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5:1.5b',
    });
    expect(env.MODELS_EMBED).toEqual({
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

// A representative env mirroring the models `MODELS_CHAT` key: development selects
// ollama, a production overlay flips to bedrock. Proves the profile overlay can
// flip provider and merge cleanly — deep-merge carries the ollama-only `baseUrl`
// into the merged object, and the discriminated union strips it (zod object-strip)
// when the bedrock variant validates.
function flipEnv(appEnv: AppEnv) {
  return createEnv({
    isServer: true,
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    server: { MODELS_CHAT: jsonEnv(chatConfigSchema) },
    createFinalSchema: (shape) =>
      withProfiles(shape, appEnv, {
        default: {
          MODELS_CHAT: {
            provider: 'ollama',
            baseUrl: 'http://localhost:11434/v1',
            model: 'qwen2.5:1.5b',
          },
        },
        production: {
          MODELS_CHAT: {
            provider: 'bedrock',
            region: 'eu-west-2',
            model: 'eu.anthropic.claude-3-7-sonnet-20250219-v1:0',
          },
        },
      }),
    runtimeEnv: {},
    emptyStringAsUndefined: true,
  });
}

describe('profile overlay flipping provider', () => {
  it('flips ollama → bedrock and strips the ollama-only baseUrl on merge', () => {
    const { MODELS_CHAT } = flipEnv('production');
    expect(MODELS_CHAT).toEqual({
      provider: 'bedrock',
      region: 'eu-west-2',
      model: 'eu.anthropic.claude-3-7-sonnet-20250219-v1:0',
    });
    expect(MODELS_CHAT).not.toHaveProperty('baseUrl');
  });

  it('keeps the base ollama variant when no overlay applies', () => {
    expect(flipEnv('development').MODELS_CHAT.provider).toBe('ollama');
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
  it('resolves the env-selected ollama embed model', () => {
    const model = resolveEmbedModel(env.MODELS_EMBED);
    expect(model.provider).toContain('ollama');
    expect(model.modelId).toBe('nomic-embed-text');
  });
});

describe('resolveChatModel / resolveTitleModel', () => {
  it('resolves the ollama chat model', () => {
    const model = resolveChatModel(env.MODELS_CHAT);
    expect(model.provider).toContain('ollama');
    expect(model.modelId).toBe('qwen2.5:1.5b');
  });

  it('falls the title model back to the chat model when no title model is set', () => {
    // No title model in the base profile, so the title model reuses the chat
    // model id — the fallback each provider factory promises.
    expect(resolveTitleModel(env.MODELS_CHAT).modelId).toBe('qwen2.5:1.5b');
  });
});
