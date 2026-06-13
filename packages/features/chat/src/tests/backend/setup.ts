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

import { chatService } from '../../api/services/chat-service';
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
vi.mock('@acme/subscriptions', () => ({
  getCreditLimit: vi.fn().mockReturnValue(250),
  getBillingWindow: vi.fn().mockReturnValue({
    start: Math.floor(Date.now() / 1000),
    end: Math.floor(Date.now() / 1000) + 86_400 * 30,
  }),
  getCredits: vi.fn().mockResolvedValue({
    remaining: 100,
    limit: 250,
    resetAt: Math.floor(Date.now() / 1000) + 86_400 * 30,
  }),
  getUserSubscriptionFromRedis: vi.fn().mockResolvedValue({ status: 'none' }),
  getSubscriptionType: vi.fn().mockReturnValue('Basic'),
  isTierAtLeast: vi.fn((tier: string, minTier: string) => {
    const rank: Record<string, number> = { Basic: 0, Standard: 1, Pro: 2 };
    return (rank[tier] ?? 0) >= (rank[minTier] ?? 0);
  }),
}));
// Mock server-only module - allows importing server components in vitest
vi.mock('server-only', () => ({}));

// Mock the RAG Workflow to return predictable responses. The module is mocked
// so constructing the workflow (Bedrock client, llamaindex index) is a no-op at
// import time; the streamed deltas are supplied per-test via the chatService
// spy in beforeEach below.
async function* mockRagQuery() {
  yield { delta: 'Test ', raw: 'Test ' };
  yield { delta: 'response ', raw: 'response ' };
  yield { delta: 'from ', raw: 'from ' };
  yield { delta: 'mocked ', raw: 'mocked ' };
  yield { delta: 'LLM.', raw: 'LLM.' };
}

vi.mock('../../api/services/rag-workflow', () => {
  class RagWorkflow {
    query = vi.fn();
  }

  return { RagWorkflow };
});

// Mock llamaindex Bedrock client
vi.mock('@llamaindex/aws', () => ({
  Bedrock: vi.fn().mockImplementation(() => ({
    chat: vi.fn().mockResolvedValue({
      message: { content: 'Mocked LLM response' },
    }),
  })),
}));

// Establish the default streamed-response implementation before each test. The
// base vitest config sets `mockReset: true`, which wipes mock implementations
// before every test (this hook runs after that reset), so the default must be
// (re)applied here rather than only at mock-factory time. Tests that need a
// different stream (e.g. mid-stream failure) override this spy locally.
beforeEach(() => {
  vi.spyOn(chatService, 'query').mockImplementation(mockRagQuery);
});

// Clean up after each test
afterEach(async () => {
  try {
    await cleanupTestData();
  } catch {
    // Ignore cleanup errors (DB might not be connected in some test scenarios)
  }
});
