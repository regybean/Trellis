/**
 * `startInfra` driven with a descriptor set that starts no container.
 *
 * The engine used to resolve the repo root at import and keep its containers in
 * a module-level list, so a second call in one process was not a second
 * construction and nothing here was reachable. These tests are that property
 * held down: two handles, independently owned, from one process — and no
 * container runtime required to get them.
 * See ../../../../../docs/adr/0003-the-engine-hands-back-a-handle.md.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { startInfra } from '../../../../containers';

describe('startInfra with nothing to start', () => {
  it('hands back the repo root it resolved', async () => {
    const infra = await startInfra([]);

    // The marker `findRepoRoot` walks up to. Asserted as a file on disk rather
    // than as a path string: what the engine owes a descriptor's repo-relative
    // bind mount is a root that exists.
    expect(existsSync(resolve(infra.repoRoot, 'pnpm-workspace.yaml'))).toBe(
      true,
    );

    await infra.stop();
  });

  it('contributes no env when no infra was started', async () => {
    const infra = await startInfra([]);

    expect(infra.env).toEqual({});

    await infra.stop();
  });

  it('puts the reaper toggle where testcontainers will read it', async () => {
    const infra = await startInfra([]);

    // The value is the run's own — this suite never overrides it — so what is
    // asserted is that the toggle reaches `process.env` at all, which is the
    // only place testcontainers looks for it.
    expect(process.env.TESTCONTAINERS_RYUK_DISABLED).toBeDefined();

    await infra.stop();
  });

  it('is constructible twice in one process, with a handle each', async () => {
    const first = await startInfra([]);
    const second = await startInfra([]);

    expect(second).not.toBe(first);
    expect(second.env).not.toBe(first.env);
    expect(second.repoRoot).toBe(first.repoRoot);

    await first.stop();
    await second.stop();
  });

  it('stops without complaint, twice', async () => {
    const infra = await startInfra([]);

    await expect(infra.stop()).resolves.toBeUndefined();
    await expect(infra.stop()).resolves.toBeUndefined();
  });
});
