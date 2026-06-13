/**
 * Testcontainers Setup
 *
 * Automatically detects if docker-compose infrastructure is running (via pnpm infra:up).
 * If services are detected on standard ports (5432, 6379), uses them.
 * Otherwise, starts testcontainers on alternative ports (15432, 16379).
 */

/* eslint-disable no-restricted-syntax, turbo/no-undeclared-env-vars */

import { spawn } from 'child_process';
import { resolve } from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';
import type { StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { GenericContainer, Wait } from 'testcontainers';

const TEST_POSTGRES_PORT = 5432;
const TEST_REDIS_PORT = 6379;
const TEST_LOCALSTACK_PORT = 4566;
// Pin to a community image — `:latest` can resolve to a license-gated build.
const LOCALSTACK_IMAGE = 'localstack/localstack:3.8.1';
const DB_USER = 'postgres';
const DB_PASSWORD = 'password123';
const DB_NAME = 'testdb';
const DB_VECTOR_NAME = 'vectordb';

// Migration mutex to prevent concurrent migrations from the same app directory
let migrationPromise: Promise<void> | null = null;

export interface TestContainers {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  usingDockerCompose: boolean;
}

let containersInstance: TestContainers | null = null;

/**
 * Start PostgreSQL container with pgvector extension for tests.
 * Uses port 5432 to match docker-compose.
 */
export async function startPostgresContainer() {
  // Resolve the absolute path to the db-init directory
  const dbInitPath = resolve(__dirname, '../../../../ops/db-init');
  console.log('   📁 DB init scripts path:', dbInitPath);

  // Use pgvector image to match production
  // Use the proper PostgreSqlContainer methods for credentials instead of withEnvironment
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
    .withExposedPorts(TEST_POSTGRES_PORT)
    .withUsername(DB_USER)
    .withPassword(DB_PASSWORD)
    .withDatabase(DB_NAME)
    .withEnvironment({
      // Only set additional env vars, not credentials
      DB_VECTOR_NAME: DB_VECTOR_NAME,
    })
    .withBindMounts([
      {
        source: dbInitPath,
        target: '/docker-entrypoint-initdb.d',
        mode: 'ro',
      },
    ])
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/),
    )
    .start();

  // Use the container's getter methods to ensure we get the correct values
  process.env.DB_HOST = container.getHost();
  process.env.DB_PORT = String(container.getMappedPort(TEST_POSTGRES_PORT));
  process.env.DB_USER = container.getUsername();
  process.env.DB_PASSWORD = container.getPassword();
  process.env.DB_NAME = container.getDatabase();

  console.log(
    '🐘 Starting PostgreSQL testcontainer on host port',
    process.env.DB_PORT,
  );

  // Create a wrapper that matches the PostgreSqlContainer interface
  return container;
}

/**
 * Start Redis container for tests.
 * Uses port 16379 to not conflict with docker-compose (6379).
 */
export async function startRedisContainer() {
  const container = await new RedisContainer()
    .withExposedPorts(TEST_REDIS_PORT)
    .start();

  process.env.REDIS_URL = `redis://${container.getHost()}:${String(container.getMappedPort(TEST_REDIS_PORT))}`;
  console.log('🔴 Starting Redis testcontainer on url ', process.env.REDIS_URL);

  return container;
}

/**
 * Start a LocalStack container exposing Secrets Manager (and S3) for tests of
 * the `aws` secrets backend. Independent of the Postgres/Redis lifecycle so a
 * test can bring up only the infra it needs.
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

/**
 * Push database schemas using drizzle-kit.
 * This creates the necessary tables in the test database.
 * Returns a promise that resolves when migration is complete.
 * Uses a mutex to ensure migrations from the same app directory don't run concurrently.
 */
async function pushDatabaseSchemas(): Promise<void> {
  console.log('📊 Pushing database schemas...');
  console.log(
    `   DB credentials: ${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  );

  // Wait for any in-progress migration to complete before starting a new one
  if (migrationPromise) {
    console.log('   ⏳ Waiting for concurrent migration to complete...');
    await migrationPromise;
  }

  // Create and store new migration promise
  migrationPromise = new Promise((resolve, reject) => {
    try {
      const child = spawn(
        `cd ../../../apps/${process.env.NEXT_PUBLIC_WEBAPP} && pnpm`,
        ['db:migrate'],
        {
          stdio: 'inherit',
          cwd: process.cwd(), // ensure you're in the project root
          shell: true, // important on Windows
          env: {
            ...process.env,
            // All DB credentials should already be in process.env from startPostgresContainer
            // but we explicitly pass them to ensure they're in the child process
          },
        },
      );

      child.on('close', (code) => {
        if (code === 0) {
          console.log('✅ pnpm db:migrate completed successfully');
          migrationPromise = null; // Clear the mutex
          resolve();
        } else {
          console.error(`❌ pnpm db:migrate failed with code ${code}`);
          migrationPromise = null; // Clear the mutex
          reject(new Error(`db:migrate failed with code ${code}`));
        }
      });

      child.on('error', (error) => {
        console.warn('   ⚠ Schema push encountered an issue:', error);
        migrationPromise = null; // Clear the mutex
        reject(error);
      });

      console.log(
        '   ℹ Database ready. Tests should set up their own tables as needed.',
      );
    } catch (error) {
      console.warn('   ⚠ Schema push encountered an issue:', error);
      console.log('   → Tests may need to set up schemas manually');
      migrationPromise = null; // Clear the mutex
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });

  await migrationPromise;
}

/**
 * Start all test containers.
 * Automatically detects if docker-compose services are running:
 * - If found on ports 5432/6379, uses them
 * - Otherwise starts testcontainers on ports 15432/16379
 *
 * Call this from globalSetup in your vitest config.
 */
export async function startContainers(): Promise<TestContainers> {
  if (containersInstance) {
    return containersInstance;
  }
  console.log('⚠️  Docker-compose services not found.');

  const [postgres, redis] = await Promise.all([
    startPostgresContainer(),
    startRedisContainer(),
  ]);

  containersInstance = { postgres, redis, usingDockerCompose: false };

  // Set additional env vars (credentials already set in startPostgresContainer)
  process.env.DB_VECTOR_NAME = DB_VECTOR_NAME;

  console.log('\n✅ Testcontainers started:');
  console.log(`   PostgreSQL: ${process.env.DB_HOST}:${process.env.DB_PORT}`);
  console.log(`   Redis: ${process.env.REDIS_URL}\n`);

  // Push database schemas and wait for completion
  await pushDatabaseSchemas();

  return containersInstance;
}

/**
 * Stop all test containers.
 * Only stops testcontainers, not docker-compose services.
 * Call this from globalTeardown in your vitest config.
 */
export async function stopContainers(): Promise<void> {
  if (!containersInstance) {
    return;
  }

  // Don't stop docker-compose services
  if (containersInstance.usingDockerCompose) {
    console.log(
      '\n✅ Tests complete. Docker-compose services remain running.\n',
    );
    containersInstance = null;
    return;
  }

  console.log('\n🛑 Stopping testcontainers...\n');

  await Promise.all([
    containersInstance.postgres.stop(),
    containersInstance.redis.stop(),
  ]);

  containersInstance = null;

  console.log('✅ Testcontainers stopped.\n');
}
