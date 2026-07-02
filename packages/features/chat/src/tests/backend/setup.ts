/**
 * Backend Test Setup
 *
 * Runs before each test file (after `@acme/test-utils/hydrate-env`, which has
 * populated `process.env` with the testcontainer DB/Redis details). Every
 * `env.ts` validates against the real running services — no env mocks. Only
 * behavioral mocks live here: `server-only`, and the `chatAgent.stream` spy that
 * keeps Bedrock/the vector store out of the router tests.
 */

import { afterEach, beforeEach, vi } from 'vitest';

import { chatAgent } from '../../api/services/chat-agent';
import { cleanupTestData } from './utils/test-context';

// Mock server-only module - allows importing server components in vitest
vi.mock('server-only', () => ({}));

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
