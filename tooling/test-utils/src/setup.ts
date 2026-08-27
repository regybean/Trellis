/**
 * Backend global-setup factory.
 *
 * `runInfraSetup(descriptors)` returns a Vitest `globalSetup` function that
 * brings up exactly the infra a suite names — always as throwaway
 * testcontainers, on every run (see ADR 0033) — publishes the merged connection
 * env to test workers as a single `infraEnv` record (hydrated into `process.env`
 * by `@acme/test-utils/hydrate-env`), and tears the containers down after.
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

import 'vitest';

import type { TestProject } from 'vitest/node';

import type { InfraDescriptor } from './infra';
import { pushDatabaseSchemas, startInfra, stopInfra } from './containers';

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

    const infraEnv = await startInfra(descriptors);
    project.provide('infraEnv', infraEnv);
    console.log('   📤 Provided to test workers:', infraEnv);

    // Every Postgres we start is fresh and empty, so app tables are always
    // provisioned here.
    if (descriptors.some((d) => d.name === 'postgres')) {
      const targetSchema = project.config.env.NEXT_PUBLIC_WEBAPP;
      if (!targetSchema) {
        throw new Error(
          'NEXT_PUBLIC_WEBAPP is required to name the schema to push into',
        );
      }
      // drizzle-kit push reads the connection from process.env; test.env doesn't
      // reach this main process, so seed it from the container's resolved values
      // before spawning.
      Object.assign(process.env, infraEnv, {
        NEXT_PUBLIC_WEBAPP: targetSchema,
      });
      await pushDatabaseSchemas(targetSchema);
    }

    console.log('\n✅ Global setup complete!\n');
    return async () => {
      console.log('\n🧹 Global teardown: Cleaning up...\n');
      await stopInfra();
      console.log('✅ Global teardown complete!\n');
    };
  };
}
