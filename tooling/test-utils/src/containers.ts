/**
 * Testcontainers engine.
 *
 * Generic: given an `InfraDescriptor` (pure data owned by the infra package —
 * see `@acme/db/testing`, `@acme/redis/testing`), start the matching container
 * and project its host/port into the `process.env` keys that infra validates.
 * This module holds no per-infra knowledge (no pinned Postgres/Redis image, no
 * credentials) — that lives with each owner. See docs/adr/0017.
 *
 * In CI a real container is started per descriptor; locally we assume a
 * docker-compose stack (`pnpm infra:up`) is already listening on the standard
 * port. LocalStack (for the secrets-backend test) keeps its own bespoke helpers
 * below — a single consumer that never composes with the descriptor set.
 */

/* eslint-disable no-restricted-syntax, turbo/no-undeclared-env-vars */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { StartedTestContainer } from 'testcontainers';
import { GenericContainer, Wait } from 'testcontainers';

import type { InfraDescriptor } from './infra';

const TEST_LOCALSTACK_PORT = 4566;
// Pin to a community image — `:latest` can resolve to a license-gated build.
const LOCALSTACK_IMAGE = 'localstack/localstack:3.8.1';

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

// Migration mutex to prevent concurrent migrations from the same app directory.
let migrationPromise: Promise<void> | null = null;

export interface StartedInfra {
  descriptor: InfraDescriptor;
  /** Present only when a real testcontainer was started (CI path). */
  container?: StartedTestContainer;
  /** Resolved `process.env` values this infra contributes for test workers. */
  env: Record<string, string>;
}

let startedInfra: StartedInfra[] = [];

/** Interpolate `{host}`/`{port}` into a descriptor's `provides` templates. */
function resolveProvides(
  descriptor: InfraDescriptor,
  host: string,
  port: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, template] of Object.entries(descriptor.provides)) {
    out[key] = template
      .replaceAll('{host}', host)
      .replaceAll('{port}', String(port));
  }
  return out;
}

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
  const env = resolveProvides(
    descriptor,
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
    env: resolveProvides(descriptor, 'localhost', descriptor.localPort),
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
 * decision). Gated by the caller on Postgres being in the infra set. Uses a
 * mutex so migrations from the same app directory don't run concurrently.
 */
export async function pushDatabaseSchemas(webapp: string): Promise<void> {
  console.log('📊 Pushing database schemas...');
  console.log(
    `   DB credentials: ${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  );

  if (migrationPromise) {
    console.log('   ⏳ Waiting for concurrent migration to complete...');
    await migrationPromise;
  }

  migrationPromise = new Promise((resolvePromise, reject) => {
    try {
      const child = spawn(
        `cd ../../../apps/${webapp} && pnpm`,
        ['db:migrate'],
        {
          stdio: 'inherit',
          cwd: process.cwd(),
          shell: true,
          env: { ...process.env },
        },
      );

      child.on('close', (code) => {
        migrationPromise = null;
        if (code === 0) {
          console.log('✅ pnpm db:migrate completed successfully');
          resolvePromise();
        } else {
          console.error(`❌ pnpm db:migrate failed with code ${code}`);
          reject(new Error(`db:migrate failed with code ${code}`));
        }
      });

      child.on('error', (error) => {
        console.warn('   ⚠ Schema push encountered an issue:', error);
        migrationPromise = null;
        reject(error);
      });
    } catch (error) {
      console.warn('   ⚠ Schema push encountered an issue:', error);
      migrationPromise = null;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });

  await migrationPromise;
}

/**
 * Start a LocalStack container exposing Secrets Manager (and S3) for tests of
 * the `aws` secrets backend. Independent of the descriptor set so that test can
 * bring up only the infra it needs.
 */
let localstackInstance: StartedTestContainer | null = null;

export async function startLocalstackContainer() {
  if (localstackInstance) {
    return localstackInstance;
  }
  const container = await new GenericContainer(LOCALSTACK_IMAGE)
    .withExposedPorts(TEST_LOCALSTACK_PORT)
    .withEnvironment({ SERVICES: 's3,secretsmanager' })
    .withWaitStrategy(Wait.forLogMessage('Ready.'))
    .start();

  localstackInstance = container;
  const url = `http://${container.getHost()}:${String(container.getMappedPort(TEST_LOCALSTACK_PORT))}`;
  console.log('🟣 Starting LocalStack testcontainer on', url);
  return container;
}

export function getLocalstackUrl(): string {
  if (!localstackInstance) {
    throw new Error('LocalStack container has not been started');
  }
  return `http://${localstackInstance.getHost()}:${String(localstackInstance.getMappedPort(TEST_LOCALSTACK_PORT))}`;
}

export async function stopLocalstackContainer(): Promise<void> {
  if (!localstackInstance) {
    return;
  }
  await localstackInstance.stop();
  localstackInstance = null;
}
