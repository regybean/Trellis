/**
 * Testcontainers engine.
 *
 * Generic: given an `InfraDescriptor` (owned by the infra package — see
 * `@acme/db/testing`, `@acme/redis/testing`), start the matching container and
 * ask the descriptor to project its host/port into the `process.env` keys that
 * infra validates. This module holds no per-infra knowledge (no pinned image, no
 * credentials) — that lives with each owner. See ../docs/adr/0001-test-infra-owned-by-infra-package.md.
 *
 * A real container is started per descriptor on *every* run — primary checkout,
 * worktree and CI alike. There is no compose path: testcontainers binds random
 * host ports, so a suite never collides with, nor reads from, a dev stack. That
 * is what makes a backend suite runnable anywhere without provisioning
 * anything first, which is the property to preserve if this is ever revisited.
 */

/* eslint-disable no-restricted-syntax */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Readable } from 'node:stream';
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

/**
 * Lines kept from a starting container's output, so a chatty image can't grow
 * the buffer without bound while its wait strategy is still unsatisfied. The
 * tail is the useful end — a failure explains itself in what the container said
 * last.
 */
const STARTUP_LOG_LINES = 200;

/**
 * Capture a starting container's own output, for the error if it never becomes
 * ready.
 *
 * `Wait.forLogMessage` failing reports only that the line never arrived, which
 * is the one thing the descriptor author already knows. The container's own
 * output usually says why — a rejected credential, a mount that isn't there, an
 * image that needs a command. So: buffered, never printed. The engine runs on
 * every backend suite everywhere, and a passing run has to look exactly as it
 * did before, which is why `release()` drops the tail on success instead of
 * logging it.
 */
function captureStartupLogs() {
  const lines: string[] = [];
  let capturing = true;

  const push = (line: unknown) => {
    if (!capturing) return;
    lines.push(String(line).trimEnd());
    if (lines.length > STARTUP_LOG_LINES) lines.shift();
  };

  return {
    consume: (stream: Readable) => {
      stream.on('data', push);
      stream.on('err', push);
    },
    /** Stop accumulating and free the tail, once the container is up. */
    release: () => {
      capturing = false;
      lines.length = 0;
    },
    tail: () => lines.join('\n'),
  };
}

/** Start a real container described by the descriptor. */
async function startOne(descriptor: InfraDescriptor): Promise<StartedInfra> {
  let builder = new GenericContainer(descriptor.image).withExposedPorts(
    descriptor.containerPort,
  );
  if (descriptor.containerEnv) {
    builder = builder.withEnvironment(descriptor.containerEnv);
  }
  if (descriptor.command?.length) {
    builder = builder.withCommand(descriptor.command);
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
  // Absent means absent: testcontainers keeps its own default rather than one of
  // ours standing in for it, since a default here would be the same guess about
  // image weight with worse provenance.
  if (descriptor.startupTimeoutMs !== undefined) {
    builder = builder.withStartupTimeout(descriptor.startupTimeoutMs);
  }

  const logs = captureStartupLogs();
  builder = builder.withLogConsumer(logs.consume);

  let container: StartedTestContainer;
  try {
    container = await builder.start();
  } catch (cause) {
    const tail = logs.tail();
    throw new Error(
      `${descriptor.name} testcontainer (${descriptor.image}) failed to start.\n` +
        (tail
          ? `Container output:\n${tail}`
          : 'The container produced no output.'),
      { cause },
    );
  }
  logs.release();

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

/**
 * Directory of the app whose aggregated Drizzle schema owns every push-managed
 * table.
 *
 * Discovered, and no app is named. This package is distributed content, so a
 * hardcoded app directory makes backend tests unrunnable in any repo whose apps
 * are called something else — `spawn` fails on a cwd that does not exist, and
 * reports it as a missing `pnpm`. The marker is the push config itself:
 * `drizzle.push.config.ts` is what the command below passes to drizzle-kit, so
 * an app that has one can serve the push.
 *
 * Sorted-first among the candidates, arbitrarily on purpose. Where several apps
 * aggregate the same push-managed tables, each provisions the same schema and a
 * preference would have nothing to be right about; where they differ, the fix is
 * one app owning the aggregate rather than a tiebreak here.
 */
function findPushApp(): string {
  const apps = resolve(REPO_ROOT, 'apps');
  const hasConfig = (name: string) =>
    existsSync(resolve(apps, name, 'drizzle.push.config.ts'));

  const candidates = existsSync(apps)
    ? readdirSync(apps, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && hasConfig(entry.name))
        .map((entry) => entry.name)
        .sort()
    : [];

  const [first] = candidates;
  if (!first)
    throw new Error(
      'pushDatabaseSchemas: no app under apps/* has a drizzle.push.config.ts — ' +
        'backend tests need one app aggregating the push-managed schemas.',
    );
  return resolve(apps, first);
}

/**
 * Provision app-owned tables into a fresh testcontainer Postgres via
 * `drizzle-kit push --force`.
 *
 * Push (not migrate): this repo is push-based — an app's `migrations/` holds no
 * SQL, so `drizzle-kit migrate` creates nothing. `push` reads `schema.ts`
 * directly and force-syncs it, exactly like `pnpm db:push` in dev. See
 * ../docs/adr/0002-test-schema-provisioning-db-push.md.
 *
 * The push app (`findPushApp`) aggregates every feature's push-managed schema,
 * so one push creates all of them. `targetSchema` is the
 * suite's isolated Postgres
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
  // user/name are authored config the owning slice declares (`@acme/db`
  // `postgres`/`testdb`), so they no longer ride `process.env` here.
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
        cwd: findPushApp(),
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
