/**
 * Global Setup for Backend Tests
 *
 * This runs once before all tests. Responsible for:
 * - Starting testcontainers for DB/Redis (in CI or when USE_TESTCONTAINERS=true)
 * - Running database migrations if needed
 *
 * To use:
 * - Add to vitest.config.ts: globalSetup: ['@acme/test-utils/setup']
 * - Or import and call directly in your own globalSetup file
 */

/* eslint-disable no-restricted-syntax, turbo/no-undeclared-env-vars */

import net from 'node:net';

import 'vitest';

import type { TestProject } from 'vitest/node';

import { startContainers, stopContainers } from './containers';

declare global {
  var __TEST_CONTAINERS_STARTED__: boolean;
}

/**
 * Check whether a TCP port is accepting connections on localhost.
 *
 * Engine-agnostic: works whether the service is provided by docker-compose,
 * podman, or any locally running process. Avoids shelling out to a container
 * CLI (and the non-portable `docker ps --filter publish=` flag).
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

async function isPostgresRunning(port: number): Promise<boolean> {
  return isPortOpen(port);
}

async function isRedisRunning(port: number): Promise<boolean> {
  return isPortOpen(port);
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

export async function setup(project: TestProject) {
  console.log('\n🧪 Global setup: Starting backend test environment...\n');
  console.log(
    `   📋 Using NEXT_PUBLIC_WEBAPP=${process.env.NEXT_PUBLIC_WEBAPP}`,
  );

  const shouldUseTestcontainers = process.env.CI === 'true';

  if (shouldUseTestcontainers) {
    await startContainers();
    globalThis.__TEST_CONTAINERS_STARTED__ = true;
  } else {
    console.log('🐳 Using local docker-compose for database and Redis...');
    const dbPort = parseInt(process.env.DB_PORT ?? '5432', 10);
    const redisPort = parseInt(
      (process.env.REDIS_URL ?? 'redis://localhost:6379').split(':').pop() ??
        '6379',
      10,
    );

    console.log(
      `   DB: ${process.env.DB_HOST ?? 'localhost'}:${dbPort}/testdb`,
    );
    console.log(
      `   Redis: ${process.env.REDIS_URL ?? 'redis://localhost:6379'}`,
    );

    // Check if local infrastructure is running
    console.log('\n🔍 Checking local infrastructure...\n');
    const pgRunning = await isPostgresRunning(dbPort);
    const redisRunning = await isRedisRunning(redisPort);

    if (!pgRunning) {
      throw new Error(
        `PostgreSQL is not running on port ${dbPort}. Please start your local docker-compose services.`,
      );
    }

    if (!redisRunning) {
      throw new Error(
        `Redis is not running on port ${redisPort}. Please start your local docker-compose services.`,
      );
    }

    console.log('   ✅ PostgreSQL is running');
    console.log('   ✅ Redis is running');

    globalThis.__TEST_CONTAINERS_STARTED__ = false;
  }

  // defaults for docker local setup
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const dbHost = process.env.DB_HOST ?? 'localhost';
  const dbPort = process.env.DB_PORT ?? '5432';
  const dbUser = process.env.DB_USER ?? 'postgres';
  const dbName = process.env.DB_NAME ?? 'testdb';
  const dbPassword = process.env.DB_PASSWORD ?? 'password123';
  const nextPublicWebapp = process.env.NEXT_PUBLIC_WEBAPP ?? 'nextjs';

  project.provide('REDIS_URL', redisUrl);
  project.provide('DB_HOST', dbHost);
  project.provide('DB_PORT', dbPort);
  project.provide('DB_USER', dbUser);
  project.provide('DB_PASSWORD', dbPassword);
  project.provide('DB_NAME', dbName);
  project.provide('NEXT_PUBLIC_WEBAPP', nextPublicWebapp);

  console.log('   📤 Provided to test workers:');
  console.log(`      REDIS_URL: ${redisUrl}`);
  console.log(`      DB: ${dbUser}@${dbHost}:${dbPort}/${dbName}`);

  console.log('\n✅ Global setup complete!\n');
  return async () => {
    await teardown();
  };
}

export async function teardown() {
  console.log('\n🧹 Global teardown: Cleaning up...\n');

  if (globalThis.__TEST_CONTAINERS_STARTED__) {
    await stopContainers();
  }

  console.log('✅ Global teardown complete!\n');
}

export default setup;
