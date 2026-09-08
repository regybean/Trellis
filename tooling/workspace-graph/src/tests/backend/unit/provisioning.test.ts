import { describe, expect, it } from 'vitest';

import type { ModelsSelection } from '../../../provisioning';
import {
  composeEnvironment,
  portOf,
  pruneInfra,
  roleUsing,
} from '../../../provisioning';

const ollamaChat = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'qwen2.5:1.5b',
};
const ollamaEmbed = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'nomic-embed-text',
};
const bedrockChat = { provider: 'bedrock', model: 'claude-on-bedrock' };
const bedrockEmbed = { provider: 'bedrock', model: 'titan-embed' };

const onOllama: ModelsSelection = {
  MODELS_CHAT: ollamaChat,
  MODELS_EMBED: ollamaEmbed,
};
const onBedrock: ModelsSelection = {
  MODELS_CHAT: bedrockChat,
  MODELS_EMBED: bedrockEmbed,
};

const localstripe = { stripe: { mode: 'localstripe' } };

describe('roleUsing', () => {
  it('names the role that runs on the provider', () => {
    expect(
      roleUsing('ollama', {
        MODELS_CHAT: bedrockChat,
        MODELS_EMBED: ollamaEmbed,
      }),
    ).toBe(ollamaEmbed);
  });

  it('names the chat role when both run on the provider', () => {
    expect(roleUsing('ollama', onOllama)).toBe(ollamaChat);
  });

  it('names nothing when neither role runs on the provider', () => {
    expect(roleUsing('ollama', onBedrock)).toBeUndefined();
  });
});

describe('pruneInfra', () => {
  it('returns the profiles a closure needs as a value', () => {
    expect(
      pruneInfra(['billing', 'ollama', 'postgres', 'redis'], {
        ...localstripe,
        models: onOllama,
      }),
    ).toEqual(['billing', 'ollama', 'postgres', 'redis']);
  });

  it('drops ollama when no role selects it', () => {
    expect(
      pruneInfra(['ollama', 'postgres'], {
        ...localstripe,
        models: onBedrock,
      }),
    ).toEqual(['postgres']);
  });

  it('keeps ollama when one role selects it', () => {
    expect(
      pruneInfra(['ollama'], {
        ...localstripe,
        models: { MODELS_CHAT: bedrockChat, MODELS_EMBED: ollamaEmbed },
      }),
    ).toEqual(['ollama']);
  });

  it('drops billing when the authored connection is real Stripe', () => {
    expect(
      pruneInfra(['billing', 'postgres'], {
        stripe: { mode: 'stripe' },
        models: onOllama,
      }),
    ).toEqual(['postgres']);
  });

  it('leaves a profile no rule names alone, in candidate order', () => {
    expect(
      pruneInfra(['redis', 'jaeger', 'localstack', 'postgres'], {
        stripe: { mode: 'stripe' },
        models: onBedrock,
      }),
    ).toEqual(['redis', 'jaeger', 'localstack', 'postgres']);
  });

  it('assumes nothing on for a closure that declares nothing', () => {
    expect(pruneInfra([], { ...localstripe, models: onOllama })).toEqual([]);
  });
});

describe('portOf', () => {
  it('parses the port a connection URL names', () => {
    expect(portOf('redis://localhost:6379')).toBe('6379');
    expect(portOf('http://localhost:11434/v1')).toBe('11434');
  });

  it('is empty when the URL states no port', () => {
    expect(portOf('redis://localhost')).toBe('');
  });

  it('refuses a string with no scheme to parse', () => {
    expect(() => portOf('localhost/6379')).toThrow();
  });

  // `localhost:` reads as the scheme and `6379` as the path, so this parses and
  // states no port — worth pinning, since it looks like a host and a port.
  it('is empty for a bare host:port, which names no scheme', () => {
    expect(portOf('localhost:6379')).toBe('');
  });
});

describe('composeEnvironment', () => {
  const input = {
    db: { DB_PORT: 5444, DB_USER: 'postgres', DB_NAME: 'testdb' },
    rag: { DB_VECTOR_NAME: 'vectordb' },
    redis: { REDIS_URL: 'redis://localhost:6379' },
    models: onOllama,
  };

  it('returns every interpolated value as a record, ports parsed out of the URLs', () => {
    expect(composeEnvironment(input)).toEqual({
      DB_PORT: '5444',
      DB_USER: 'postgres',
      DB_NAME: 'testdb',
      DB_VECTOR_NAME: 'vectordb',
      REDIS_PORT: '6379',
      OLLAMA_PORT: '11434',
      OLLAMA_CHAT_MODEL: 'qwen2.5:1.5b',
      OLLAMA_EMBED_MODEL: 'nomic-embed-text',
    });
  });

  it('takes the ollama port from whichever role runs on ollama', () => {
    const env = composeEnvironment({
      ...input,
      models: {
        MODELS_CHAT: bedrockChat,
        MODELS_EMBED: { ...ollamaEmbed, baseUrl: 'http://localhost:11500/v1' },
      },
    });

    expect(env.OLLAMA_PORT).toBe('11500');
    expect(env.OLLAMA_CHAT_MODEL).toBe('claude-on-bedrock');
  });

  it('fails loud rather than guess a port when no role runs on ollama', () => {
    expect(() =>
      composeEnvironment({ ...input, models: onBedrock }),
    ).toThrowError(/no ollama role/);
  });
});
