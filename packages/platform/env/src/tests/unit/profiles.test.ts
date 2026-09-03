import { createEnv } from '@t3-oss/env-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

import type { AppEnv } from '../../app-env';
import { withProfiles } from '../../profiles';

/**
 * `withProfiles` is exercised through a real `createEnv` call, because that is
 * its contract — it is a `createFinalSchema` implementation and only means
 * anything inside one. A slice's `env.ts` is this, with real keys.
 *
 * Under vitest `shouldSkipEnvValidation()` is false (ADR 0014), so these are
 * "real runs" unless a case stubs `npm_lifecycle_event=lint` to model a lint run.
 */
const connection = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('localstripe'), apiBase: z.url() }),
  z.object({ mode: z.literal('real') }),
]);

function sampleEnv({
  appEnv = 'development' as AppEnv,
  runtimeEnv = {} as Record<string, string | undefined>,
  isServer = true,
} = {}) {
  return createEnv({
    isServer,
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    shared: { SHARED_LABEL: z.string().nonempty() },
    server: {
      HOST: z.string().nonempty(),
      PORT: z.coerce.number().int().positive(),
      EXTENSIONS: z.array(z.string().nonempty()).nonempty(),
      CONNECTION: connection,
      SECRET: z.string().nonempty(),
    },
    createFinalSchema: (shape) =>
      withProfiles(shape, appEnv, {
        default: {
          SHARED_LABEL: 'base',
          HOST: 'localhost',
          PORT: 5444,
          EXTENSIONS: ['pdf', 'txt'],
          CONNECTION: {
            mode: 'localstripe',
            apiBase: 'http://localhost:8420',
          },
        },
        production: {
          HOST: 'db.internal',
          EXTENSIONS: ['pdf'],
          CONNECTION: { mode: 'real' },
        },
      }),
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('withProfiles — profile resolution', () => {
  it('resolves every config key to its coerced profile default with no env at all', () => {
    const env = sampleEnv({ runtimeEnv: { SECRET: 'shh' } });

    expect(env.HOST).toBe('localhost');
    // Coerced by the schema, not carried through `runtimeEnv` as a string.
    expect(env.PORT).toBe(5444);
    expect(env.EXTENSIONS).toStrictEqual(['pdf', 'txt']);
    expect(env.SHARED_LABEL).toBe('base');
  });

  it('lets the production overlay win only for the keys it sets', () => {
    const env = sampleEnv({
      appEnv: 'production',
      runtimeEnv: { SECRET: 'shh' },
    });

    expect(env.HOST).toBe('db.internal');
    // Unset by the overlay — keeps the base profile's value.
    expect(env.PORT).toBe(5444);
    expect(env.SHARED_LABEL).toBe('base');
  });

  it('replaces arrays rather than concatenating them', () => {
    const env = sampleEnv({
      appEnv: 'production',
      runtimeEnv: { SECRET: 'shh' },
    });

    expect(env.EXTENSIONS).toStrictEqual(['pdf']);
  });

  it('deep-merges an object value, letting the schema strip the fields the overlay replaced', () => {
    const env = sampleEnv({
      appEnv: 'production',
      runtimeEnv: { SECRET: 'shh' },
    });

    // The overlay flips the discriminant; `apiBase` rides in from the base on the
    // deep merge and the union strips it, so no dev field survives the swap.
    expect(env.CONNECTION).toStrictEqual({ mode: 'real' });
  });

  it('serves a target with no overlay of its own from the base (dev-is-base)', () => {
    // `staging` is unauthored above. It inherits the development base rather than
    // throwing, because every key is env-overridable (ADR 0001 §4): a deploy
    // target's own values arrive as environment variables, and authoring an
    // overlay is for values that belong in version control.
    const env = sampleEnv({ appEnv: 'staging', runtimeEnv: { SECRET: 'shh' } });

    expect(env.HOST).toBe('localhost');
  });
});

/**
 * The `@acme/db` `DB_PASSWORD` shape: a value the base authors as a local
 * throwaway, which must become a demanded secret on a real target. Hoisted so
 * the literal reads as an identifier rather than an inline password
 * (`sonarjs/no-hardcoded-passwords`), the same way `@acme/db` hoists its own.
 */
const LOCAL_THROWAWAY_SECRET = 'local-throwaway';

/** The injected counterpart — what a real target supplies from the environment. */
const INJECTED_SECRET = 'from-env';

function credentialEnv({
  appEnv = 'development' as AppEnv,
  runtimeEnv = {} as Record<string, string | undefined>,
} = {}) {
  return createEnv({
    isServer: true,
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    server: { PASSWORD: z.string().nonempty() },
    createFinalSchema: (shape) =>
      withProfiles(shape, appEnv, {
        default: { PASSWORD: LOCAL_THROWAWAY_SECRET },
        production: { PASSWORD: undefined },
      }),
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}

describe('withProfiles — unauthoring a key in an overlay', () => {
  it('serves the base value on the target that authors it', () => {
    expect(credentialEnv().PASSWORD).toBe(LOCAL_THROWAWAY_SECRET);
  });

  it('demands the key as a secret on a target that unauthors it', () => {
    expect(() => credentialEnv({ appEnv: 'production' })).toThrow(/PASSWORD/);
  });

  it('takes the unauthored key from the environment', () => {
    const env = credentialEnv({
      appEnv: 'production',
      runtimeEnv: { PASSWORD: INJECTED_SECRET },
    });

    expect(env.PASSWORD).toBe(INJECTED_SECRET);
  });
});

describe('withProfiles — the config/secret line', () => {
  it('fails loudly, naming the key, when a secret is absent on a real run', () => {
    expect(() => sampleEnv()).toThrow(/SECRET/);
  });

  it('fails on the zod shape rather than handing a caller NaN', () => {
    expect(() =>
      sampleEnv({ runtimeEnv: { SECRET: 'shh', PORT: 'abc' } }),
    ).toThrow(/PORT/);
  });

  it('relaxes only the secrets when the run cannot supply one, keeping every config default', () => {
    vi.stubEnv('npm_lifecycle_event', 'lint');

    const env = sampleEnv();

    // The whole point of the per-key skip: `skipValidation: true` would have
    // returned `runtimeEnv` raw, so HOST/PORT/EXTENSIONS would all be undefined.
    expect(env.HOST).toBe('localhost');
    expect(env.PORT).toBe(5444);
    expect(env.EXTENSIONS).toStrictEqual(['pdf', 'txt']);
    expect(env.SECRET).toBeUndefined();
  });
});

describe('withProfiles — env override', () => {
  it('honours an override for any key the call lists in runtimeEnv', () => {
    const env = sampleEnv({
      runtimeEnv: { SECRET: 'shh', HOST: 'from-env', PORT: '6000' },
    });

    expect(env.HOST).toBe('from-env');
    expect(env.PORT).toBe(6000);
  });

  it('cannot be reached for a key the call leaves out of runtimeEnv', () => {
    // Every slice lists every key (ADR 0001 §4), so this is the mechanism rather
    // than a policy: profile values ride the schema, and only `runtimeEnv` is read.
    vi.stubEnv('EXTENSIONS', 'from-env');

    const env = sampleEnv({ runtimeEnv: { SECRET: 'shh' } });

    expect(env.EXTENSIONS).toStrictEqual(['pdf', 'txt']);
  });

  it('treats an empty row as absent rather than as an override', () => {
    const env = sampleEnv({ runtimeEnv: { SECRET: 'shh', HOST: '' } });

    expect(env.HOST).toBe('localhost');
  });
});

describe('withProfiles — the client access guard', () => {
  it('throws when a server key is read in client code', () => {
    const env = sampleEnv({ isServer: false, runtimeEnv: { SECRET: 'shh' } });

    expect(() => env.HOST).toThrow(/server-side environment variable/);
  });

  it('still serves a shared key on the client from its profile default', () => {
    const env = sampleEnv({ isServer: false, runtimeEnv: { SECRET: 'shh' } });

    expect(env.SHARED_LABEL).toBe('base');
  });
});
