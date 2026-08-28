import { createEnv } from '@t3-oss/env-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import { jsonEnv } from '../../json-env';
import { withProfiles } from '../../profiles';

/**
 * `jsonEnv` is exercised through a real `createEnv` call for the same reason
 * `withProfiles` is: it only means anything inside one. Both of its inputs are
 * real and both are covered — the authored literal arriving through
 * `.prefault()`, and the JSON string arriving through `runtimeEnv`.
 *
 * The shapes mirror the kinds of key in the tree that need it: a record
 * (`CREDIT_LIMITS`), a discriminated union (`MODELS_CHAT`, `STRIPE_CONNECTION`)
 * and a boolean (`MEMORY_SEMANTIC_RECALL`).
 */
const provider = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('ollama'), baseUrl: z.url() }),
  z.object({ provider: z.literal('bedrock'), region: z.string().nonempty() }),
]);

const AUTHORED_LIMITS = { Basic: 250, Pro: 1600 };

function sampleEnv(runtimeEnv: Record<string, string | undefined> = {}) {
  return createEnv({
    isServer: true,
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    server: {
      LIMITS: jsonEnv(z.record(z.string(), z.coerce.number().int().positive())),
      MODEL: jsonEnv(provider),
      ENABLED: jsonEnv(z.boolean()),
    },
    createFinalSchema: (shape) =>
      withProfiles(shape, 'development', {
        default: {
          LIMITS: AUTHORED_LIMITS,
          MODEL: { provider: 'ollama', baseUrl: 'http://localhost:11434/v1' },
          ENABLED: true,
        },
      }),
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}

describe('jsonEnv — the authored literal', () => {
  it('resolves from the profile when the environment says nothing', () => {
    expect(sampleEnv().LIMITS).toEqual(AUTHORED_LIMITS);
  });

  it('still validates the literal rather than waving it through', () => {
    // A profile value is fed *through* the schema by `.prefault()`, so a wrong
    // literal fails at boot — `jsonEnv`'s union must not become an escape hatch
    // from that. The literal has to fail a *refinement* to be testable at all:
    // anything the shape rejects outright is already a compile error on the
    // literal, which is the union's other job.
    expect(() =>
      createEnv({
        isServer: true,
        clientPrefix: 'NEXT_PUBLIC_',
        client: {},
        server: { HOSTS: jsonEnv(z.array(z.url())) },
        createFinalSchema: (shape) =>
          withProfiles(shape, 'development', {
            default: { HOSTS: ['not-a-url'] },
          }),
        runtimeEnv: {},
        emptyStringAsUndefined: true,
      }),
    ).toThrow(/HOSTS/);
  });
});

describe('jsonEnv — the environment override', () => {
  it('takes a JSON object from the environment', () => {
    const env = sampleEnv({ LIMITS: '{"Basic":10}' });

    expect(env.LIMITS).toEqual({ Basic: 10 });
  });

  it('takes a whole discriminated-union variant as one document', () => {
    // Structured keys are overridden whole (`MODELS_CHAT`, not
    // `MODELS_CHAT__provider`): the union exists so a half-configured value
    // cannot be represented, and per-field override would give that back.
    const env = sampleEnv({
      MODEL: '{"provider":"bedrock","region":"eu-west-2"}',
    });

    expect(env.MODEL).toEqual({ provider: 'bedrock', region: 'eu-west-2' });
  });

  it('reads a boolean as JSON, so "false" is false', () => {
    // The reason a boolean is not `z.coerce.boolean()`: coercion makes every
    // non-empty string true, so an operator disabling something would have
    // enabled it.
    expect(sampleEnv({ ENABLED: 'false' }).ENABLED).toBe(false);
  });

  it('rejects a value the schema does not accept, JSON or not', () => {
    expect(() => sampleEnv({ LIMITS: '{"Basic":-1}' })).toThrow(/LIMITS/);
  });

  it('names the key when the override is not JSON at all', () => {
    expect(() => sampleEnv({ MODEL: 'bedrock' })).toThrow(/MODEL/);
  });

  it('falls back to the authored value when the variable is empty', () => {
    // `emptyStringAsUndefined` — an exported-but-blank variable is "unset", not
    // "an empty record".
    expect(sampleEnv({ LIMITS: '' }).LIMITS).toEqual(AUTHORED_LIMITS);
  });
});
