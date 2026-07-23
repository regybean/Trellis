import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import type { ConfigContext } from '../../create-config';
import { configExtends, createConfig } from '../../create-config';
import { ConfigValidationError } from '../../errors';

const server = (isServer: boolean, appEnv: ConfigContext['appEnv']) => ({
  appEnv,
  isServer,
});

// A representative slice config: one coerced number, one per-env string, one
// server-only value, and an array that overlays should replace not concatenate.
function sampleConfig(context: ConfigContext) {
  return createConfig({
    server: { SUCCESS_PATH: z.string().startsWith('/') },
    client: {
      PLAN_ID: z.string(),
      TRIAL_DAYS: z.coerce.number().int().positive(),
      REGIONS: z.array(z.string()),
    },
    profiles: {
      default: {
        server: { SUCCESS_PATH: '/success' },
        client: {
          PLAN_ID: 'price_dev',
          TRIAL_DAYS: '14',
          REGIONS: ['eu-west-2'],
        },
      },
      staging: { client: { PLAN_ID: 'price_stg' } },
      production: {
        client: {
          PLAN_ID: 'price_live',
          TRIAL_DAYS: '7',
          REGIONS: ['us-east-1', 'eu-west-1'],
        },
      },
    },
    context,
  });
}

describe('createConfig — profile layering', () => {
  it('uses the base (development) profile when appEnv is development', () => {
    const config = sampleConfig(server(true, 'development'));
    expect(config.PLAN_ID).toBe('price_dev');
    expect(config.SUCCESS_PATH).toBe('/success');
  });

  it('overlays staging over the base, leaving untouched keys at base', () => {
    const config = sampleConfig(server(true, 'staging'));
    expect(config.PLAN_ID).toBe('price_stg');
    expect(config.TRIAL_DAYS).toBe(14); // inherited from base, coerced
  });

  it('overlays production over the base', () => {
    const config = sampleConfig(server(true, 'production'));
    expect(config.PLAN_ID).toBe('price_live');
    expect(config.TRIAL_DAYS).toBe(7);
  });

  it('coerces on the merged result (string → number)', () => {
    const config = sampleConfig(server(true, 'development'));
    expect(config.TRIAL_DAYS).toBe(14);
    expect(typeof config.TRIAL_DAYS).toBe('number');
  });

  it('replaces arrays rather than concatenating them (mergeArrays: false)', () => {
    const config = sampleConfig(server(true, 'production'));
    expect(config.REGIONS).toEqual(['us-east-1', 'eu-west-1']);
  });
});

describe('createConfig — validation', () => {
  it('throws ConfigValidationError when a value fails its schema', () => {
    expect(() =>
      createConfig({
        client: { PATH: z.string().startsWith('/') },
        profiles: { default: { client: { PATH: 'no-leading-slash' } } },
        context: server(true, 'development'),
      }),
    ).toThrowError(ConfigValidationError);
  });

  it('throws when the base profile omits a required key', () => {
    expect(() =>
      createConfig({
        client: { NEEDED: z.string() },
        profiles: { default: { client: {} } },
        context: server(true, 'development'),
      }),
    ).toThrowError(ConfigValidationError);
  });
});

describe('createConfig — client guard', () => {
  it('reads server keys freely on the server', () => {
    const config = sampleConfig(server(true, 'development'));
    expect(config.SUCCESS_PATH).toBe('/success');
  });

  it('throws when a server-only key is read on the client', () => {
    const config = sampleConfig(server(false, 'development'));
    expect(() => config.SUCCESS_PATH).toThrowError(/server-only/);
  });

  it('still exposes client keys on the client', () => {
    const config = sampleConfig(server(false, 'development'));
    expect(config.PLAN_ID).toBe('price_dev');
  });

  it('is read-only', () => {
    const config = sampleConfig(server(true, 'development'));
    expect(() => {
      // @ts-expect-error — config is read-only by contract
      config.PLAN_ID = 'mutated';
    }).toThrowError(/read-only/);
  });
});

function authConfig(context: ConfigContext) {
  return createConfig({
    client: { SIGN_IN_URL: z.string().startsWith('/') },
    profiles: { default: { client: { SIGN_IN_URL: '/sign-in' } } },
    context,
  });
}

describe('configExtends', () => {
  it('merges several slice configs into one flat object', () => {
    const context = server(true, 'development');
    const config = configExtends([authConfig(context), sampleConfig(context)]);
    expect(config.SIGN_IN_URL).toBe('/sign-in');
    expect(config.PLAN_ID).toBe('price_dev');
    expect(config.SUCCESS_PATH).toBe('/success');
  });

  it('preserves the client guard across merged slices', () => {
    const context = server(false, 'development');
    const config = configExtends([authConfig(context), sampleConfig(context)]);
    expect(config.SIGN_IN_URL).toBe('/sign-in');
    expect(() => config.SUCCESS_PATH).toThrowError(/server-only/);
  });

  it('accepts an empty list (the slim-app edge)', () => {
    expect(Object.keys(configExtends([]))).toHaveLength(0);
  });

  it('rejects a value that is not a createConfig result', () => {
    expect(() => configExtends([{ PLAN_ID: 'x' }])).toThrowError(
      /createConfig/,
    );
  });
});
