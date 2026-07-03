/**
 * Testcontainers engine.
 *
 * Generic: given an `InfraDescriptor` (owned by the infra package — see
 * `@acme/db/testing`, `@acme/redis/testing`), start the matching container and
 * ask the descriptor to project its host/port into the `process.env` keys that
 * infra validates. This module holds no per-infra knowledge (no pinned image, no
 * credentials) — that lives with each owner. See docs/adr/0017.
 *
 * In CI a real container is started per descriptor; locally we assume a
 * docker-compose stack (`pnpm infra:up`) is already listening on the standard
 * port.
 */

/* eslint-disable no-restricted-syntax, turbo/no-undeclared-env-vars */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { StartedTestContainer } from 'testcontainers';
import { GenericContainer, Wait } from 'testcontainers';

import type { InfraDescriptor } from './infra';

// Walk up to the monorepo root (the dir with pnpm-workspace.yaml) so a
// descriptor's repo-relative bind mount resolves regardless of whether this
// module runs from `src` (JIT) or `dist`.
function findRepoRoot(start: string): string {
  let dir = start;
  let parent = dirname(dir);
  while (parent !== dir) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = parent;
    parent = dirname(dir);
  }
  return start;
}
const REPO_ROOT = findRepoRoot(__dirname);

export interface StartedInfra {
  descriptor: InfraDescriptor;
  /** Present only when a real testcontainer was started (CI path). */
  container?: StartedTestContainer;
  /** Resolved `process.env` values this infra contributes for test workers. */
  env: Record<string, string>;
}

let startedInfra: StartedInfra[] = [];

/** CI path: start a real container described by the descriptor. */
async function startOne(descriptor: InfraDescriptor): Promise<StartedInfra> {
  let builder = new GenericContainer(descriptor.image).withExposedPorts(
    descriptor.containerPort,
  );
  if (descriptor.containerEnv) {
    builder = builder.withEnvironment(descriptor.containerEnv);
  }
  if (descriptor.bindMounts?.length) {
    builder = builder.withBindMounts(
      descriptor.bindMounts.map((mount) => ({
        source: resolve(REPO_ROOT, mount.repoPath),
        target: mount.target,
        mode: mount.mode ?? 'ro',
      })),
    );
  }
  builder = builder.withWaitStrategy(
    Wait.forLogMessage(
      new RegExp(descriptor.waitLogRegex),
      descriptor.waitLogTimes ?? 1,
    ),
  );

  const container = await builder.start();
  const env = descriptor.provides(
    container.getHost(),
    container.getMappedPort(descriptor.containerPort),
  );
  console.log(`   🐳 ${descriptor.name} testcontainer ready:`, env);
  return { descriptor, container, env };
}

/** Local path: resolve against a docker-compose service already listening. */
function resolveLocal(descriptor: InfraDescriptor): StartedInfra {
  return {
    descriptor,
    env: descriptor.provides(
      'localhost',
      descriptor.localPort ?? descriptor.containerPort,
    ),
  };
}

/**
 * Bring up the given infra and return the merged `process.env` contribution.
 * `useTestcontainers` picks the CI (real container) vs local (compose) path.
 */
export async function startInfra(
  descriptors: InfraDescriptor[],
  { useTestcontainers }: { useTestcontainers: boolean },
): Promise<Record<string, string>> {
  startedInfra = useTestcontainers
    ? await Promise.all(descriptors.map(startOne))
    : descriptors.map(resolveLocal);

  const env: Record<string, string> = {};
  for (const started of startedInfra) {
    Object.assign(env, started.env);
  }
  return env;
}

/** Stop every real container started by `startInfra` (no-op for local). */
export async function stopInfra(): Promise<void> {
  const running = startedInfra
    .map((s) => s.container)
    .filter((c): c is StartedTestContainer => c !== undefined);
  await Promise.all(running.map((c) => c.stop()));
  startedInfra = [];
}

/**
 * Push database schemas by delegating to the app's own migration.
 *
 * The `apps/$WEBAPP db:migrate` reach is intentionally left here rather than in
 * `@acme/db` (see docs/adr/0016 — migration ownership is a separate, later
 * decision). Gated by the caller on Postgres being in the infra set.
 */
export async function pushDatabaseSchemas(webapp: string): Promise<void> {
  console.log('📊 Pushing database schemas...');
  console.log(
    `   DB credentials: ${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  );

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(`cd ../../../apps/${webapp} && pnpm`, ['db:migrate'], {
      stdio: 'inherit',
      cwd: process.cwd(),
      shell: true,
      env: { ...process.env },
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`db:migrate failed with code ${code}`));
      }
    });
    child.on('error', reject);
  });

  console.log('✅ pnpm db:migrate completed successfully');
}
