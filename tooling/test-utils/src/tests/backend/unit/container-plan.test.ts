/**
 * `containerPlan` — every decision the engine takes about a descriptor before a
 * container exists.
 *
 * This is the descriptor contract read back: the two defaults, the compiled wait
 * pattern, the repo-relative mount resolution, and the two fields whose absence
 * is meaningful. A real descriptor drives it, and nothing starts.
 */
import { describe, expect, it } from 'vitest';

import type { InfraDescriptor } from '../../../infra';
import { containerPlan } from '../../../containers';

const REPO_ROOT = '/repo';

/** The smallest descriptor the contract allows — every optional field absent. */
const minimal: InfraDescriptor = {
  name: 'postgres',
  image: 'postgres:17-alpine',
  containerPort: 5432,
  waitLogRegex: 'database system is ready to accept connections',
  provides: (host, port) => ({ DB_HOST: host, DB_PORT: String(port) }),
};

describe('containerPlan', () => {
  it('carries the descriptor image and exposes its container port', () => {
    const plan = containerPlan(REPO_ROOT, minimal);

    expect(plan.image).toBe('postgres:17-alpine');
    expect(plan.exposedPorts).toEqual([5432]);
  });

  it('defaults container env to empty and the wait count to one', () => {
    const plan = containerPlan(REPO_ROOT, minimal);

    expect(plan.environment).toEqual({});
    expect(plan.waitLogTimes).toBe(1);
  });

  it('leaves command and startup timeout absent when the descriptor gives none', () => {
    const plan = containerPlan(REPO_ROOT, minimal);

    expect(plan).not.toHaveProperty('command');
    expect(plan).not.toHaveProperty('startupTimeoutMs');
  });

  it('leaves command absent when the descriptor gives an empty one', () => {
    const plan = containerPlan(REPO_ROOT, { ...minimal, command: [] });

    expect(plan).not.toHaveProperty('command');
  });

  it('carries the optional fields a descriptor does set', () => {
    const plan = containerPlan(REPO_ROOT, {
      ...minimal,
      containerEnv: { POSTGRES_PASSWORD: 'password123' },
      command: ['redis-server', '--appendonly', 'no'],
      waitLogTimes: 2,
      startupTimeoutMs: 120_000,
    });

    expect(plan.environment).toEqual({ POSTGRES_PASSWORD: 'password123' });
    expect(plan.command).toEqual(['redis-server', '--appendonly', 'no']);
    expect(plan.waitLogTimes).toBe(2);
    expect(plan.startupTimeoutMs).toBe(120_000);
  });

  it('compiles the wait log source string into a pattern that matches', () => {
    const plan = containerPlan(REPO_ROOT, {
      ...minimal,
      waitLogRegex: 'ready to accept connections',
    });

    expect(plan.waitLogRegex.test('LOG:  ready to accept connections')).toBe(
      true,
    );
    expect(plan.waitLogRegex.test('LOG:  shutting down')).toBe(false);
  });

  it('resolves a repo-relative mount source against the repo root', () => {
    const plan = containerPlan(REPO_ROOT, {
      ...minimal,
      bindMounts: [
        { repoPath: 'deploy/init.sql', target: '/docker-entrypoint/init.sql' },
      ],
    });

    expect(plan.bindMounts).toEqual([
      {
        source: '/repo/deploy/init.sql',
        target: '/docker-entrypoint/init.sql',
        mode: 'ro',
      },
    ]);
  });

  it('keeps an explicit mount mode and defaults the rest to read-only', () => {
    const plan = containerPlan(REPO_ROOT, {
      ...minimal,
      bindMounts: [
        { repoPath: 'a', target: '/a', mode: 'rw' },
        { repoPath: 'b', target: '/b' },
      ],
    });

    expect(plan.bindMounts.map((mount) => mount.mode)).toEqual(['rw', 'ro']);
  });

  it('gives no mounts when the descriptor declares none', () => {
    expect(containerPlan(REPO_ROOT, minimal).bindMounts).toEqual([]);
  });
});
