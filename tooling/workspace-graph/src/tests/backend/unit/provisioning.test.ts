/**
 * Discovery against fixture repos rather than this one: what a closure declares
 * is the input, so the honest test is a workspace built to declare it. Asserting
 * against this checkout's own package set would encode its slices in the
 * assertions — the coupling the discovery replaced.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  composeEnvironment,
  discoverProfiles,
  neededProfiles,
  neededSeeds,
} from '../../../provisioning';
import { workspacePackages } from '../../../workspace';
import {
  createWorkspaceFixture,
  removeWorkspaceFixtures,
} from '../workspace-fixture';

afterAll(() => {
  removeWorkspaceFixtures();
});

/** A provisioning module declaring `declaration`, as a package would author it. */
const declaring = (declaration: unknown) =>
  `export const PROVISIONING = ${JSON.stringify(declaration)};\n`;

/**
 * A fixture whose packages are `{ <name>: { infra, seeds, provisioning } }`,
 * where `provisioning` is the declaration to write as that package's module.
 */
interface FixturePackage {
  readonly infra?: readonly string[];
  readonly seeds?: Readonly<Record<string, unknown>>;
  readonly provisioning?: unknown;
  /** Written verbatim instead of a declaration — for a module that is broken. */
  readonly module?: string;
}

const fixture = (packages: Readonly<Record<string, FixturePackage>>) => {
  const files: Record<string, string> = {};
  const manifests = Object.fromEntries(
    Object.entries(packages).map(
      ([name, { infra, seeds, provisioning, module }]) => {
        const declares = provisioning !== undefined || module !== undefined;
        if (declares) {
          files[`packages/shared/${name}/provisioning.mjs`] =
            module ?? declaring(provisioning);
        }
        return [
          `packages/shared/${name}`,
          {
            name: `@fixture/${name}`,
            acme: {
              ...(infra ? { infra } : {}),
              ...(seeds ? { seeds } : {}),
              ...(declares ? { provisioning: './provisioning.mjs' } : {}),
            },
          },
        ];
      },
    ),
  );

  return workspacePackages(
    createWorkspaceFixture({
      globs: ['packages/shared/*'],
      packages: manifests,
      files,
    }),
  );
};

describe('discoverProfiles', () => {
  it('returns the profiles the closure declares, with what its packages supply', async () => {
    const profiles = await discoverProfiles(
      fixture({
        db: {
          infra: ['postgres'],
          provisioning: { postgres: { compose: { DB_PORT: 5444 } } },
        },
        billing: {
          infra: ['billing'],
          seeds: { billing: 'seed:localstripe' },
          provisioning: { billing: { needed: true } },
        },
      }),
    );

    expect(profiles).toEqual([
      {
        name: 'billing',
        needed: true,
        compose: {},
        seeds: [{ package: '@fixture/billing', script: 'seed:localstripe' }],
      },
      {
        name: 'postgres',
        needed: true,
        compose: { DB_PORT: '5444' },
        seeds: [],
      },
    ]);
  });

  it('merges what several packages supply for one profile', async () => {
    const [postgres] = await discoverProfiles(
      fixture({
        db: {
          infra: ['postgres'],
          provisioning: { postgres: { compose: { DB_NAME: 'testdb' } } },
        },
        rag: {
          infra: ['postgres'],
          provisioning: {
            postgres: { compose: { DB_VECTOR_NAME: 'vectordb' } },
          },
        },
      }),
    );

    expect(postgres?.compose).toEqual({
      DB_NAME: 'testdb',
      DB_VECTOR_NAME: 'vectordb',
    });
  });

  it('needs a declared profile no package provisions', async () => {
    const profiles = await discoverProfiles(
      fixture({ queue: { infra: ['redis'] } }),
    );

    expect(profiles).toEqual([
      { name: 'redis', needed: true, compose: {}, seeds: [] },
    ]);
  });

  it('ignores a contribution to a profile the closure does not declare', async () => {
    const profiles = await discoverProfiles(
      fixture({
        models: {
          provisioning: { ollama: { compose: { OLLAMA_PORT: '11434' } } },
          seeds: { ollama: 'seed:models' },
        },
      }),
    );

    expect(profiles).toEqual([]);
  });

  it('assumes nothing for a set that declares nothing', async () => {
    expect(await discoverProfiles([])).toEqual([]);
  });

  it('refuses a module it cannot load, naming the package', async () => {
    await expect(
      discoverProfiles(
        fixture({ db: { module: 'export const PROVISIONING = {' } }),
      ),
    ).rejects.toThrow(/@fixture\/db/);
  });

  it('refuses a module that declares no PROVISIONING export', async () => {
    await expect(
      discoverProfiles(
        fixture({ db: { module: 'export const OTHER = {};\n' } }),
      ),
    ).rejects.toThrow(/PROVISIONING/);
  });

  it('refuses a compose value that is not a string or a number', async () => {
    await expect(
      discoverProfiles(
        fixture({
          db: {
            infra: ['postgres'],
            provisioning: {
              postgres: { compose: { DB_PORT: { port: 5444 } } },
            },
          },
        }),
      ),
    ).rejects.toThrow(/DB_PORT/);
  });

  it('refuses two packages supplying one compose value differently', async () => {
    await expect(
      discoverProfiles(
        fixture({
          db: {
            infra: ['postgres'],
            provisioning: { postgres: { compose: { DB_PORT: 5444 } } },
          },
          rag: {
            infra: ['postgres'],
            provisioning: { postgres: { compose: { DB_PORT: 5555 } } },
          },
        }),
      ),
    ).rejects.toThrow(/DB_PORT/);
  });
});

describe('neededProfiles', () => {
  it('drops a profile its owner says the configuration does not need', async () => {
    const profiles = await discoverProfiles(
      fixture({
        rag: { infra: ['ollama', 'postgres'] },
        models: { provisioning: { ollama: { needed: false } } },
      }),
    );

    expect(neededProfiles(profiles)).toEqual(['postgres']);
  });

  it('keeps a profile every owner needs, in candidate order', async () => {
    const profiles = await discoverProfiles(
      fixture({
        rag: { infra: ['ollama', 'postgres'] },
        models: { provisioning: { ollama: { needed: true } } },
      }),
    );

    expect(neededProfiles(profiles)).toEqual(['ollama', 'postgres']);
  });

  it('drops a profile one owner does not need even when another does', async () => {
    const profiles = await discoverProfiles(
      fixture({
        rag: { infra: ['ollama'], provisioning: { ollama: { needed: true } } },
        models: { provisioning: { ollama: { needed: false } } },
      }),
    );

    expect(neededProfiles(profiles)).toEqual([]);
  });
});

describe('neededSeeds', () => {
  it('names the package and the script for every started profile', async () => {
    const profiles = await discoverProfiles(
      fixture({
        billing: { infra: ['billing'], seeds: { billing: 'seed:localstripe' } },
        db: { infra: ['postgres'], seeds: { postgres: 'seed:fixtures' } },
      }),
    );

    expect(neededSeeds(profiles)).toEqual([
      { package: '@fixture/billing', script: 'seed:localstripe' },
      { package: '@fixture/db', script: 'seed:fixtures' },
    ]);
  });

  it('leaves out the seed of a profile that was pruned', async () => {
    const profiles = await discoverProfiles(
      fixture({
        billing: {
          infra: ['billing'],
          seeds: { billing: 'seed:localstripe' },
          provisioning: { billing: { needed: false } },
        },
      }),
    );

    expect(neededSeeds(profiles)).toEqual([]);
  });

  it('ignores a seed that names no script', async () => {
    const profiles = await discoverProfiles(
      fixture({ billing: { infra: ['billing'], seeds: { billing: 7 } } }),
    );

    expect(neededSeeds(profiles)).toEqual([]);
  });
});

describe('composeEnvironment', () => {
  it('is every value the discovered profiles supply, as strings', async () => {
    const profiles = await discoverProfiles(
      fixture({
        db: {
          infra: ['postgres'],
          provisioning: {
            postgres: {
              compose: {
                DB_PORT: 5444,
                DB_USER: 'postgres',
                DB_NAME: 'testdb',
              },
            },
          },
        },
        redis: {
          infra: ['redis'],
          provisioning: { redis: { compose: { REDIS_PORT: '6379' } } },
        },
        rag: {
          infra: ['ollama', 'postgres'],
          provisioning: {
            postgres: { compose: { DB_VECTOR_NAME: 'vectordb' } },
          },
        },
        models: {
          provisioning: {
            ollama: { compose: { OLLAMA_PORT: '11434' }, needed: true },
          },
        },
      }),
    );

    expect(composeEnvironment(profiles)).toEqual({
      DB_PORT: '5444',
      DB_USER: 'postgres',
      DB_NAME: 'testdb',
      DB_VECTOR_NAME: 'vectordb',
      REDIS_PORT: '6379',
      OLLAMA_PORT: '11434',
    });
  });

  it('succeeds with ollama absent — nothing declared it', async () => {
    const profiles = await discoverProfiles(
      fixture({
        db: {
          infra: ['postgres'],
          provisioning: { postgres: { compose: { DB_PORT: 5444 } } },
        },
      }),
    );

    expect(composeEnvironment(profiles)).toEqual({ DB_PORT: '5444' });
  });

  it('is empty for a closure that declares no infra at all', async () => {
    expect(
      composeEnvironment(await discoverProfiles(fixture({ ui: {} }))),
    ).toEqual({});
  });
});
