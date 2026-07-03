/**
 * Global setup for backend tests.
 *
 * Runs once before all tests. Reads the suite's declared infra from the
 * registry (`backendProject({ infra: [...] })` records it at config-eval time),
 * brings exactly that infra up — real testcontainers in CI, an assumed
 * docker-compose stack locally — and publishes the connection details to test
 * workers via `project.provide` (hydrated into `process.env` by
 * `@acme/test-utils/hydrate-env`). See docs/adr/0017.
 *
 * Wire it from a suite's config with `backendProject` (which sets
 * `globalSetup: ['@acme/test-utils/setup']` whenever the infra list is
 * non-empty).
 */

/* eslint-disable no-restricted-syntax */

import net from 'node:net';

import 'vitest';

import type { TestProject } from 'vitest/node';

import { pushDatabaseSchemas, startInfra, stopInfra } from './containers';
import { INFRA_ENV_KEY, readInfraFromEnv } from './infra';

declare global {
  var __TEST_CONTAINERS_STARTED__: boolean;
}

/**
 * Check whether a TCP port is accepting connections on localhost.
 *
 * Engine-agnostic: works whether the service is provided by docker-compose,
 * podman, or any locally running process.
 */
async function isPortOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

// ProvidedContext type augmentation is in vitest.shims.d.ts
declare module 'vitest' {
  export interface ProvidedContext {
    REDIS_URL: string | undefined;
    DB_HOST: string | undefined;
    DB_PORT: string | undefined;
    DB_USER: string | undefined;
    DB_PASSWORD: string | undefined;
    DB_NAME: string | undefined;
    NEXT_PUBLIC_WEBAPP: string | undefined;
  }
}

// The fixed vocabulary of connection keys a descriptor may contribute. Kept
// explicit so `project.provide`/`inject` stay statically typed even though which
// keys are populated is driven by the suite's descriptors.
const PROVIDED_KEYS = [
  'REDIS_URL',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
] as const;

export async function setup(project: TestProject) {
  // `test.env` reaches the test workers but not this (main-process) global-setup,
  // so read the suite's descriptors from the resolved project config's env,
  // which global-setup does receive. See docs/adr/0017.
  const descriptors = readInfraFromEnv(project.config.env[INFRA_ENV_KEY]);
  console.log('\n🧪 Global setup: Starting backend test environment...\n');
  console.log(`   📋 Infra: [${descriptors.map((d) => d.name).join(', ')}]`);

  const useTestcontainers = process.env.CI === 'true';

  if (!useTestcontainers) {
    // Local: assume a docker-compose stack is already listening. Fail loud per
    // descriptor so a missing service is obvious rather than a later timeout.
    console.log('🐳 Using local docker-compose infrastructure...');
    for (const descriptor of descriptors) {
      const running = await isPortOpen(descriptor.localPort);
      if (!running) {
        throw new Error(
          `${descriptor.name} is not running on port ${descriptor.localPort}. Start your local services with \`pnpm infra:up\`.`,
        );
      }
      console.log(`   ✅ ${descriptor.name} is running`);
    }
  }

  const infraEnv = await startInfra(descriptors, { useTestcontainers });
  globalThis.__TEST_CONTAINERS_STARTED__ = useTestcontainers;

  // Publish connection details to workers. An unpopulated key is provided as
  // undefined; hydrate-env skips it, leaving the static default from
  // `staticTestEnv` (e.g. an infra-less REDIS_URL that is never contacted).
  for (const key of PROVIDED_KEYS) {
    project.provide(key, infraEnv[key]);
  }
  console.log('   📤 Provided to test workers:', infraEnv);

  // Provision app schemas only when we started a fresh Postgres container; a
  // local compose stack is assumed already migrated.
  const hasPostgres = descriptors.some((d) => d.name === 'postgres');
  if (useTestcontainers && hasPostgres) {
    const webapp = project.config.env.NEXT_PUBLIC_WEBAPP;
    if (!webapp) {
      throw new Error(
        'NEXT_PUBLIC_WEBAPP is required to migrate the app schema',
      );
    }
    // The migration (and the app's drizzle config) reads the connection from
    // process.env; test.env doesn't reach this main process, so seed it from the
    // container's resolved values before spawning.
    Object.assign(process.env, infraEnv, { NEXT_PUBLIC_WEBAPP: webapp });
    await pushDatabaseSchemas(webapp);
  }

  console.log('\n✅ Global setup complete!\n');
  return async () => {
    await teardown();
  };
}

export async function teardown() {
  console.log('\n🧹 Global teardown: Cleaning up...\n');
  if (globalThis.__TEST_CONTAINERS_STARTED__) {
    await stopInfra();
  }
  console.log('✅ Global teardown complete!\n');
}

export default setup;
