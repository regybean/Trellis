import { afterAll, describe, expect, it } from 'vitest';

import { matchToken, resolveToken } from '../../../tokens';
import { workspacePackages } from '../../../workspace';
import {
  createWorkspaceFixture,
  removeWorkspaceFixtures,
} from '../workspace-fixture';

afterAll(() => {
  removeWorkspaceFixtures();
});

const packages = workspacePackages(
  createWorkspaceFixture({
    globs: ['apps/*', 'packages/shared/*'],
    packages: {
      'apps/nextjs': { name: '@fixture/nextjs' },
      'apps/nextjs-slim': { name: '@fixture/nextjs-slim' },
      'packages/shared/ui': { name: '@fixture/ui' },
      'packages/shared/chat': { name: '@other/chat' },
      'packages/shared/chat-ui': { name: '@fixture/chat' },
    },
  }),
);

describe('matchToken', () => {
  it('resolves a full name, an unscoped tail and a directory to one package', () => {
    const byFullName = matchToken('@fixture/nextjs', packages);
    const byTail = matchToken('nextjs', packages);
    const byDirectory = matchToken('nextjs-slim', packages);

    expect(byFullName?.name).toBe('@fixture/nextjs');
    expect(byTail).toBe(byFullName);
    expect(byDirectory?.name).toBe('@fixture/nextjs-slim');
  });

  it('prefers an exact name over a tail another package shares', () => {
    expect(matchToken('@other/chat', packages)?.rel).toBe(
      'packages/shared/chat',
    );
  });

  it('refuses a token two packages could mean, naming both', () => {
    expect(() => matchToken('chat', packages)).toThrow(
      /"chat" is ambiguous — it could mean @fixture\/chat, @other\/chat/,
    );
  });

  it('reports no match rather than guessing', () => {
    expect(matchToken('nothing', packages)).toBeUndefined();
  });
});

describe('resolveToken', () => {
  it('returns the package a token names', () => {
    expect(resolveToken('ui', packages).name).toBe('@fixture/ui');
  });

  it('refuses a token that names nothing, naming the token', () => {
    expect(() => resolveToken('nothing', packages)).toThrow(
      'unknown package "nothing"',
    );
  });

  it('says what it expected when the caller only takes one kind', () => {
    expect(() => resolveToken('nothing', packages, 'app')).toThrow(
      'unknown app "nothing"',
    );
  });
});
