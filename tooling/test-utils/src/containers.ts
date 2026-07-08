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
import { existsSync, statSync } from 'node:fs';
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

/**
 * A linked git worktree's `.git` is a *file* (a `gitdir:` pointer); the primary
 * checkout's is a *directory*. This is the runtime counterpart to the `[ -f .git ]`
 * check in `scripts/test.sh`: it makes a direct per-package `vitest` run (which
 * bypasses the turbo wrapper, so `CI` is never injected) still self-provision
 * testcontainers in a worktree rather than colliding with the primary checkout's
 * shared compose stack. See ADR 0019. (Cache-safe: direct vitest bypasses turbo,
 * so there is no cache key to partition on this path.)
 */
export function inLinkedWorktree(): boolean {
  try {
    return statSync(resolve(REPO_ROOT, '.git')).isFile();
  } catch {
    return false;
  }
}

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
  // A worktree run is always local — podman here. Its rootless machine can't
  // bind-mount the docker socket that Ryuk (the testcontainers reaper) needs, so
  // container startup dies with "operation not supported" mounting the podman
  // socket. Disable Ryuk on that path; stopInfra() + the global teardown stop
  // every container explicitly, so the reaper is only a crash-time safety net.
  // Real CI (docker, `.git` is a dir → not a linked worktree) keeps Ryuk. Set
  // in-process so it applies whether we arrived via turbo or a direct vitest run;
  // an explicit outer value wins.
  if (useTestcontainers && inLinkedWorktree()) {
    process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true';
  }

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
  console.log(
    `   DB credentials: ${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  );

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
