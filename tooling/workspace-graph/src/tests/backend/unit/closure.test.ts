import { afterAll, describe, expect, it } from 'vitest';

import { declaredInfra } from '../../../closure';
import { workspacePackages } from '../../../workspace';
import {
  createWorkspaceFixture,
  removeWorkspaceFixtures,
} from '../workspace-fixture';

afterAll(() => {
  removeWorkspaceFixtures();
});

const packagesDeclaring = (
  declarations: Record<string, Record<string, unknown>>,
) =>
  workspacePackages(
    createWorkspaceFixture({
      globs: ['packages/shared/*'],
      packages: Object.fromEntries(
        Object.entries(declarations).map(([name, manifest]) => [
          `packages/shared/${name}`,
          { name: `@fixture/${name}`, ...manifest },
        ]),
      ),
    }),
  );

describe('declaredInfra', () => {
  it('returns the union of what the packages declare', () => {
    const packages = packagesDeclaring({
      db: { acme: { infra: ['postgres'] } },
      chat: { acme: { infra: ['postgres', 'ollama'] } },
      queue: { acme: { infra: ['redis'] } },
    });

    expect(declaredInfra(packages)).toEqual(['ollama', 'postgres', 'redis']);
  });

  it('assumes nothing for a set that declares nothing', () => {
    expect(declaredInfra(packagesDeclaring({ ui: {} }))).toEqual([]);
  });

  it('ignores a declaration that is not a list of names', () => {
    const packages = packagesDeclaring({
      db: { acme: { infra: 'postgres' } },
      chat: { acme: { infra: ['ollama', 7] } },
      ui: { acme: {} },
    });

    expect(declaredInfra(packages)).toEqual(['ollama']);
  });
});
