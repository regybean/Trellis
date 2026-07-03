/**
 * Backend global-setup factory.
 *
 * `runInfraSetup(descriptors)` returns a Vitest `globalSetup` function that
 * brings up exactly the infra a suite names — real testcontainers in CI, an
 * assumed docker-compose stack locally — publishes the merged connection env to
 * test workers as a single `infraEnv` record (hydrated into `process.env` by
 * `@acme/test-utils/hydrate-env`), and tears the containers down after.
 *
 * A suite wires it from a ~5-line per-suite file that imports its descriptors as
 * live objects:
 *
 *   // src/tests/backend/global-setup.ts
 *   import { postgresContainer } from '@acme/db/testing';
 *   import { redisContainer } from '@acme/redis/testing';
 *   import { runInfraSetup } from '@acme/test-utils/setup';
 *   export default runInfraSetup([postgresContainer, redisContainer]);
 *
 * and points `backendProject({ globalSetup: './src/tests/backend/global-setup.ts' })`
 * at it. See docs/adr/0017.
 */

/* eslint-disable no-restricted-syntax */

import net from 'node:net';

import 'vitest';

import type { TestProject } from 'vitest/node';

import type { InfraDescriptor } from './infra';
import { pushDatabaseSchemas, startInfra, stopInfra } from './containers';

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

// The whole connection contribution rides through `project.provide` as one
// record, so hydrate-env (and any test) reads a single injected value rather
// than a hand-maintained per-key list.
declare module 'vitest' {
  export interface ProvidedContext {
    infraEnv: Record<string, string>;
  }
}

export function runInfraSetup(descriptors: InfraDescriptor[]) {
  return async function setup(project: TestProject) {
    console.log('\n🧪 Global setup: Starting backend test environment...\n');
    console.log(`   📋 Infra: [${descriptors.map((d) => d.name).join(', ')}]`);

    const useTestcontainers = process.env.CI === 'true';

    if (!useTestcontainers) {
      // Local: assume a docker-compose stack is already listening. Fail loud per
      // descriptor so a missing service is obvious rather than a later timeout.
      console.log('🐳 Using local docker-compose infrastructure...');
      for (const descriptor of descriptors) {
        const port = descriptor.localPort ?? descriptor.containerPort;
        if (!(await isPortOpen(port))) {
          throw new Error(
            `${descriptor.name} is not running on port ${port}. Start your local services with \`pnpm infra:up\`.`,
          );
        }
        console.log(`   ✅ ${descriptor.name} is running`);
      }
    }

    const infraEnv = await startInfra(descriptors, { useTestcontainers });
    project.provide('infraEnv', infraEnv);
    console.log('   📤 Provided to test workers:', infraEnv);

    // Provision app schemas only when we started a fresh Postgres container; a
    // local compose stack is assumed already migrated.
    if (useTestcontainers && descriptors.some((d) => d.name === 'postgres')) {
      const webapp = project.config.env.NEXT_PUBLIC_WEBAPP;
      if (!webapp) {
        throw new Error(
          'NEXT_PUBLIC_WEBAPP is required to migrate the app schema',
        );
      }
      // The migration (and the app's drizzle config) reads the connection from
      // process.env; test.env doesn't reach this main process, so seed it from
      // the container's resolved values before spawning.
      Object.assign(process.env, infraEnv, { NEXT_PUBLIC_WEBAPP: webapp });
      await pushDatabaseSchemas(webapp);
    }

    console.log('\n✅ Global setup complete!\n');
    return async () => {
      console.log('\n🧹 Global teardown: Cleaning up...\n');
      if (useTestcontainers) await stopInfra();
      console.log('✅ Global teardown complete!\n');
    };
  };
}
