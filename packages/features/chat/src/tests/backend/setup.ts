/* eslint-disable no-restricted-properties */
/**
 * Backend Test Setup
 *
 * This file runs before each test file. It's responsible for:
 * - Mocking env.ts to provide test configuration
 * - Setting up mocks for external services (LLM, S3, etc.)
 * - Configuring test-specific behavior based on environment variables
 * - Cleaning up data between tests
 */

import { afterEach, beforeEach, inject, vi } from 'vitest';

import { chatAgent } from '../../api/services/chat-agent';
import { cleanupTestData } from './utils/test-context';

// Mock the env module using factory function pattern
// The factory function receives the inject values at runtime, not at module load time
vi.mock('../../env', () => {
  const REDIS_URL = inject('REDIS_URL');
  const DB_HOST = inject('DB_HOST');
  const DB_PORT = inject('DB_PORT');
  const DB_USER = inject('DB_USER');
  const DB_PASSWORD = inject('DB_PASSWORD');
  const DB_NAME = inject('DB_NAME');
  const NEXT_PUBLIC_WEBAPP = inject('NEXT_PUBLIC_WEBAPP');

  console.log(
    '🔧 Setting up Chat backend test environment: DB_HOST=',
    DB_HOST,
    'DB_PORT=',
    DB_PORT,
    'REDIS_URL=',
    REDIS_URL,
  );

  return {
    env: {
      NODE_ENV: 'test',
      NEXT_PUBLIC_WEBAPP: NEXT_PUBLIC_WEBAPP,
      DB_HOST: DB_HOST,
      DB_PORT: DB_PORT,
      DB_USER: DB_USER,
      DB_PASSWORD: DB_PASSWORD,
      DB_NAME: DB_NAME,
      REDIS_URL: REDIS_URL,
      AWS_REGION: 'eu-west-2',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
    },
  };
});
// Point @acme/rag at the test database. Mocking the env module (resolves to the
// same file as rag's internal `./env` imports) lets Mastra Memory / storage
// connect to the testcontainer without the real env validation.
vi.mock('@acme/rag/env', () => {
  return {
    env: {
      NODE_ENV: 'test',
      NEXT_PUBLIC_WEBAPP: inject('NEXT_PUBLIC_WEBAPP'),
      DB_HOST: inject('DB_HOST'),
      DB_PORT: Number(inject('DB_PORT')),
      DB_USER: inject('DB_USER'),
      DB_PASSWORD: inject('DB_PASSWORD'),
      DB_NAME: inject('DB_NAME'),
      DB_VECTOR_NAME: 'vectordb',
      CHUNK_SIZE: 1024,
      CHUNK_OVERLAP: 20,
      AWS_REGION: 'eu-west-2',
      BEDROCK_CHAT_MODEL: 'test-model',
    },
  };
});
vi.mock('@acme/redis/env', () => {
  // Pin this package's tests to a dedicated Redis logical DB. cleanupTestData
  // calls flushDb(), which clears the whole selected DB — turbo runs feature
  // test suites in parallel against one shared Redis, so without per-package
  // DBs one suite's flush wipes another's keys mid-test.
  const injected = inject('REDIS_URL');
  if (!injected) throw new Error('REDIS_URL not provided to test workers');
  const REDIS_URL = `${injected.replace(/\/+$/, '')}/2`;

  return {
    env: {
      REDIS_URL: REDIS_URL,
    },
  };
});
// Mock server-only module - allows importing server components in vitest
vi.mock('server-only', () => ({}));
// @acme/models eagerly calls modelsEnv() at import time (in resolve.ts), which
// validates EMBED_DIMENSIONS. Tests don't need real LLM models — chatAgent.stream
// is spied on below — so stub the whole module to avoid the env validation throw.
vi.mock('@acme/models', () => ({
  chatModel: {},
  embedModel: {},
  embedProviderOptions: vi.fn().mockReturnValue({}),
}));
// @acme/rag's documents-schema imports modelsEnv() from the /env subpath to read
// EMBED_DIMENSIONS (the vector column dimension) at load time. Provide a fixed
// value so the schema builds without a real provider env configured.
vi.mock('@acme/models/env', () => ({
  modelsEnv: vi.fn().mockReturnValue({
    LLM_PROVIDER: 'ollama',
    EMBED_PROVIDER: 'ollama',
    EMBED_DIMENSIONS: 1024,
  }),
}));

// Predictable streamed response. The router consumes `chatAgent.stream(...)`
// directly, iterating the resolved result's `textStream`; spying on the agent
// keeps Bedrock and the vector store out of tests entirely. The single cast to
// the Mastra stream-result type is centralised in `asAgentStream` — tests build
// streams with `fakeAgentStream` / `throwingAgentStream`.
type AgentStreamResult = Awaited<ReturnType<typeof chatAgent.stream>>;

function asAgentStream(textStream: AsyncIterable<string>) {
  return { textStream } as unknown as AgentStreamResult;
}

export function fakeAgentStream(chunks: string[]) {
  return asAgentStream(
    (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
  );
}

export function throwingAgentStream(chunks: string[], error: Error) {
  return asAgentStream(
    (async function* () {
      for (const chunk of chunks) yield chunk;
      throw error;
    })(),
  );
}

const DEFAULT_STREAM_CHUNKS = [
  'Test ',
  'response ',
  'from ',
  'mocked ',
  'LLM.',
];

// Establish the default streamed-response implementation before each test. The
// base vitest config sets `mockReset: true`, which wipes mock implementations
// before every test (this hook runs after that reset), so the default must be
// (re)applied here rather than only at mock-factory time. Tests that need a
// different stream (e.g. mid-stream failure) override this spy locally.
beforeEach(() => {
  vi.spyOn(chatAgent, 'stream').mockResolvedValue(
    fakeAgentStream(DEFAULT_STREAM_CHUNKS),
  );
});

// Clean up after each test
afterEach(async () => {
  try {
    await cleanupTestData();
  } catch {
    // Ignore cleanup errors (DB might not be connected in some test scenarios)
  }
});
