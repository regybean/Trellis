import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import type { ConfigContext } from '../../create-config';
import { clientOverrideBuildEnv } from '../../build-env';
import { coercedBoolean } from '../../coerce';
import {
  configExtends,
  createConfig,
  describeConfig,
} from '../../create-config';
import { ConfigValidationError } from '../../errors';
import {
  CLIENT_OVERRIDES_VAR,
  isCoercionTolerant,
  readClientOverrides,
} from '../../overrides';

/**
 * Every test builds its context as a literal — no `process.env` anywhere, the
 * same purity the profile tests rely on (ADR 0026 §4). The override bag is just
 * data, which is the whole point of threading it through the context.
 */
const context = (overrides: ConfigContext['overrides']): ConfigContext => ({
  appEnv: 'development',
  isServer: true,
  overrides,
});

/** A discriminated union + an object array + a record: every addressing mode. */
const storeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('local'), apiBase: z.url() }),
  z.object({ mode: z.literal('remote'), region: z.string().nonempty() }),
]);

function sampleConfig(ctx: ConfigContext) {
  return createConfig({
    server: {
      DB_HOST: z.string().nonempty(),
      DB_PORT: z.coerce.number().int().positive(),
      SEMANTIC_RECALL: coercedBoolean(),
      store: storeSchema,
      replicas: z.array(
        z.object({ id: z.string(), weight: z.coerce.number() }),
      ),
      LIMITS: z.record(z.string(), z.coerce.number().int().positive()),
    },
    client: { PLAN_ID: z.string(), TRIAL_DAYS: z.coerce.number().int() },
    profiles: {
      default: {
        server: {
          DB_HOST: 'localhost',
          DB_PORT: 5444,
          SEMANTIC_RECALL: true,
          store: { mode: 'local', apiBase: 'http://localhost:8420' },
          replicas: [
            { id: 'a', weight: 1 },
            { id: 'b', weight: 2 },
          ],
          LIMITS: { Basic: 250, Pro: 1600 },
        },
        client: { PLAN_ID: 'price_dev', TRIAL_DAYS: 14 },
      },
      production: {
        server: { DB_HOST: 'db.internal' },
        client: { PLAN_ID: 'price_live' },
      },
    },
    context: ctx,
  });
}

describe('createConfig — server override lane', () => {
  it('resolves a scalar from a same-name env var, coerced', () => {
    const config = sampleConfig(
      context({ server: { DB_HOST: 'db.example.com', DB_PORT: '6543' } }),
    );
    expect(config.DB_HOST).toBe('db.example.com');
    expect(config.DB_PORT).toBe(6543);
  });

  it('has the last word over the APP_ENV overlay', () => {
    const config = sampleConfig({
      appEnv: 'production',
      isServer: true,
      overrides: { server: { DB_HOST: 'db.override' } },
    });
    expect(config.DB_HOST).toBe('db.override');
  });

  it('falls through to the profile value when unset or empty', () => {
    const unset = sampleConfig(context({ server: {} }));
    const empty = sampleConfig(
      context({ server: { DB_HOST: '', DB_PORT: undefined } }),
    );
    expect(unset.DB_HOST).toBe('localhost');
    expect(empty.DB_HOST).toBe('localhost');
    expect(empty.DB_PORT).toBe(5444);
  });

  it('ignores env keys the config does not declare', () => {
    const config = sampleConfig(
      context({ server: { PATH: '/usr/bin', AWS_SECRET_ACCESS_KEY: 'shh' } }),
    );
    expect(config.DB_HOST).toBe('localhost');
    expect(Object.keys(config)).not.toContain('PATH');
  });

  it('reads a boolean override as written, not as truthiness', () => {
    const config = sampleConfig(
      context({ server: { SEMANTIC_RECALL: 'false' } }),
    );
    expect(config.SEMANTIC_RECALL).toBe(false);
  });

  it('still fails validation when an override is out of range', () => {
    expect(() => sampleConfig(context({ server: { DB_PORT: '-1' } }))).toThrow(
      ConfigValidationError,
    );
  });
});

describe('createConfig — nested override paths', () => {
  it('patches one field of a nested object', () => {
    const config = sampleConfig(
      context({ server: { store__apiBase: 'http://localhost:9999' } }),
    );
    expect(config.store).toEqual({
      mode: 'local',
      apiBase: 'http://localhost:9999',
    });
  });

  it('flips a discriminated union and strips the prior variant', () => {
    const config = sampleConfig(
      context({
        server: { store__mode: 'remote', store__region: 'eu-west-2' },
      }),
    );
    expect(config.store).toEqual({ mode: 'remote', region: 'eu-west-2' });
    expect(config.store).not.toHaveProperty('apiBase');
  });

  it('rejects a union flip that omits the new variant’s fields', () => {
    expect(() =>
      sampleConfig(context({ server: { store__mode: 'remote' } })),
    ).toThrow(ConfigValidationError);
  });

  it('patches an array element by position, leaving its siblings alone', () => {
    const config = sampleConfig(
      context({ server: { replicas__1__weight: '9' } }),
    );
    expect(config.replicas).toEqual([
      { id: 'a', weight: 1 },
      { id: 'b', weight: 9 },
    ]);
  });

  it('patches a record entry by key', () => {
    const config = sampleConfig(context({ server: { LIMITS__Pro: '4000' } }));
    expect(config.LIMITS).toEqual({ Basic: 250, Pro: 4000 });
  });

  it('ignores a path with an empty segment', () => {
    const config = sampleConfig(
      context({ server: { store____apiBase: 'https://nope.example' } }),
    );
    expect(config.store).toEqual({
      mode: 'local',
      apiBase: 'http://localhost:8420',
    });
  });
});

describe('createConfig — the lanes cannot cross', () => {
  it('does not let the runtime server bag reach a client key', () => {
    const config = sampleConfig(context({ server: { PLAN_ID: 'price_hack' } }));
    expect(config.PLAN_ID).toBe('price_dev');
  });

  it('does not let the build-time client bag reach a server key', () => {
    const config = sampleConfig(context({ client: { DB_HOST: 'db.hack' } }));
    expect(config.DB_HOST).toBe('localhost');
  });

  it('applies the client bag to client keys', () => {
    const config = sampleConfig(
      context({ client: { PLAN_ID: 'price_baked', TRIAL_DAYS: '7' } }),
    );
    expect(config.PLAN_ID).toBe('price_baked');
    expect(config.TRIAL_DAYS).toBe(7);
  });
});

describe('describeConfig', () => {
  const described = describeConfig(sampleConfig(context({})));

  it('lists the declared top-level keys per side', () => {
    expect(described.serverKeys).toContain('DB_HOST');
    expect(described.clientKeys).toEqual(['PLAN_ID', 'TRIAL_DAYS']);
  });

  it('derives nested override paths down to scalar leaves', () => {
    expect(described.serverOverridePaths).toEqual(
      expect.arrayContaining([
        'DB_PORT',
        'store__mode',
        'store__apiBase',
        'store__region',
        'replicas__0__id',
        'replicas__1__weight',
        'LIMITS__Pro',
      ]),
    );
  });

  it('reports no intolerant leaves for a coercion-tolerant config', () => {
    expect(described.intolerantPaths).toEqual([]);
  });

  it('names the leaves a same-name env var could never override', () => {
    const bad = createConfig({
      server: { COUNT: z.number(), FLAG: z.boolean(), NAME: z.string() },
      profiles: {
        default: { server: { COUNT: 1, FLAG: true, NAME: 'x' } },
      },
      context: context({}),
    });
    expect(describeConfig(bad).intolerantPaths).toEqual(['COUNT', 'FLAG']);
  });

  it('spans every slice after configExtends', () => {
    const composed = configExtends([
      sampleConfig(context({})),
      createConfig({
        client: { OTHER: z.string() },
        profiles: { default: { client: { OTHER: 'o' } } },
        context: context({}),
      }),
    ]);
    expect(describeConfig(composed).clientKeys).toEqual(
      expect.arrayContaining(['PLAN_ID', 'OTHER']),
    );
  });
});

describe('isCoercionTolerant', () => {
  it.each([
    ['string', z.string()],
    ['url', z.url()],
    ['enum', z.enum(['a', 'b'])],
    ['literal', z.literal('a')],
    ['coerced number', z.coerce.number().int().positive()],
    ['coerced boolean', coercedBoolean()],
    ['constrained string', z.string().min(40)],
  ])('accepts a %s leaf', (_name, schema) => {
    expect(isCoercionTolerant(schema)).toBe(true);
  });

  it.each([
    ['number', z.number()],
    ['boolean', z.boolean()],
    ['date', z.date()],
  ])('rejects a bare %s leaf', (_name, schema) => {
    expect(isCoercionTolerant(schema)).toBe(false);
  });
});

describe('the client build-time lane', () => {
  const config = sampleConfig(context({}));

  it('inlines only the client leaves that the build environment sets', () => {
    const injected = clientOverrideBuildEnv(config, {
      PLAN_ID: 'price_baked',
      TRIAL_DAYS: '',
      DB_HOST: 'db.runtime',
    });
    expect(injected.PLAN_ID).toBe('price_baked');
    expect(injected).not.toHaveProperty('TRIAL_DAYS');
    expect(injected).not.toHaveProperty('DB_HOST');
    expect(injected[CLIENT_OVERRIDES_VAR]).toBe('{"PLAN_ID":"price_baked"}');
  });

  it('round-trips through the injected literal', () => {
    const injected = clientOverrideBuildEnv(config, { PLAN_ID: 'price_baked' });
    const baked = sampleConfig(
      context({ client: readClientOverrides(injected[CLIENT_OVERRIDES_VAR]) }),
    );
    expect(baked.PLAN_ID).toBe('price_baked');
  });

  it('treats an absent or malformed literal as no overrides', () => {
    // What an un-inlined `process.env.ACME_CONFIG_CLIENT_OVERRIDES` reads as.
    const absent: string | undefined = undefined;
    expect(readClientOverrides(absent)).toEqual({});
    expect(readClientOverrides('')).toEqual({});
    expect(readClientOverrides('not json')).toEqual({});
    expect(readClientOverrides('{"A":1}')).toEqual({});
  });
});
