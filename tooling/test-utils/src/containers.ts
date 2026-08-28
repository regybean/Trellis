/**
 * Testcontainers engine.
 *
 * Generic: given an `InfraDescriptor` (owned by the infra package — see
 * `@acme/db/testing`, `@acme/redis/testing`), start the matching container and
 * ask the descriptor to project its host/port into the `process.env` keys that
 * infra validates. This module holds no per-infra knowledge (no pinned image, no
 * credentials) — that lives with each owner. See docs/adr/0017.
 *
 * A real container is started per descriptor on *every* run — primary checkout,
 * worktree and CI alike. There is no compose path: testcontainers binds random
 * host ports, so a suite never collides with, nor reads from, the dev stack. See
 * docs/adr/0033.
 */

/* eslint-disable no-restricted-syntax */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { StartedTestContainer } from 'testcontainers';
import {
  GenericContainer,
  getContainerRuntimeClient,
  Wait,
} from 'testcontainers';

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
  container: StartedTestContainer;
  /** Resolved `process.env` values this infra contributes for test workers. */
  env: Record<string, string>;
}

let startedInfra: StartedInfra[] = [];

/**
 * Fail once, up front, when no container runtime is reachable.
 *
 * Without this, an unreachable runtime surfaces as one opaque connection error
 * per descriptor per suite — nine-plus stack traces that name a socket rather
 * than the fix. One probe before any container starts turns that into a single
 * actionable message.
 */
async function assertContainerRuntime(): Promise<void> {
  try {
    await getContainerRuntimeClient();
  } catch (cause) {
    throw new Error(
      'No container runtime is reachable, so backend tests cannot start their Postgres/Redis containers. ' +
        'Start the podman machine (`podman machine start`), or point DOCKER_HOST at a running engine, then re-run.',
      { cause },
    );
  }
}

/** Start a real container described by the descriptor. */
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

/** Bring up the given infra and return the merged `process.env` contribution. */
export async function startInfra(
  descriptors: InfraDescriptor[],
): Promise<Record<string, string>> {
  // Ryuk (the testcontainers reaper) is off by default on every run. A rootless
  // podman machine — the macOS default — can't bind-mount the docker socket Ryuk
  // needs, so startup dies with "operation not supported" and every backend run
  // fails in global-setup. Cleanup doesn't depend on it: stopInfra() in the
  // global teardown stops each container explicitly, and isolation comes from
  // testcontainers' random host ports + generated names. An explicit outer value
  // wins, so CI can opt back in.
  process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true';

  await assertContainerRuntime();
  startedInfra = await Promise.all(descriptors.map(startOne));

  const env: Record<string, string> = {};
  for (const started of startedInfra) {
    Object.assign(env, started.env);
  }
  return env;
}

/** Stop every container started by `startInfra`. */
export async function stopInfra(): Promise<void> {
  const running = startedInfra.map((s) => s.container);
  await Promise.all(running.map((c) => c.stop()));
  startedInfra = [];
}

/** The full app whose aggregated Drizzle schema owns every push-managed table. */
const CANONICAL_APP = 'nextjs';

/**
 * Provision app-owned tables into a fresh testcontainer Postgres via
 * `drizzle-kit push --force`.
 *
 * Push (not migrate): this repo is push-based — `apps/nextjs/migrations` holds no
 * SQL, so `drizzle-kit migrate` creates nothing. `push` reads `schema.ts`
 * directly and force-syncs it, exactly like `pnpm db:push` in dev. See ADR 0021.
 *
 * The canonical app (`nextjs`) aggregates every feature's push-managed schema, so
 * one push creates all of them. `targetSchema` is the suite's isolated Postgres
 * schema (`NEXT_PUBLIC_WEBAPP`) — the app's `pgSchema(NEXT_PUBLIC_WEBAPP)` tables
 * (and `CREATE SCHEMA`) land there. Mastra/pgvector tables are created lazily at
 * runtime and are excluded by the config's `tablesFilter`, so push never touches
 * them.
 *
 * `with-env` is bypassed: `setup.ts` has already put the container's `DB_*` into
 * `process.env`, so drizzle-kit is invoked directly (no dependence on a `.env`
 * file, no risk of it shadowing the container). Gated by the caller on Postgres
 * being in the infra set.
 */
export async function pushDatabaseSchemas(targetSchema: string): Promise<void> {
  console.log(`📊 Pushing database schemas into "${targetSchema}"...`);
  // Host/port are the dynamic bits (a testcontainer hands back a mapped port);
  // user/name are authored config (`@acme/db` `postgres`/`testdb`, ADR 0033),
  // so they no longer ride `process.env` here.
  console.log(`   DB target: ${process.env.DB_HOST}:${process.env.DB_PORT}`);

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      'pnpm',
      [
        'exec',
        'drizzle-kit',
        'push',
        '--config',
        'drizzle.push.config.ts',
        '--force',
      ],
      {
        stdio: 'inherit',
        cwd: resolve(REPO_ROOT, 'apps', CANONICAL_APP),
        env: { ...process.env, NEXT_PUBLIC_WEBAPP: targetSchema },
      },
    );
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`drizzle-kit push failed with code ${code}`));
      }
    });
    child.on('error', reject);
  });

  console.log('✅ drizzle-kit push completed successfully');
}
