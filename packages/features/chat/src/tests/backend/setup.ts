/**
 * Backend Test Setup
 *
 * Runs before each test file (after `@acme/test-utils/hydrate-env`, which has
 * populated `process.env` with the testcontainer DB/Redis details). Every
 * `env.ts` validates against the real running services — no env mocks. Only
 * behavioral mocks live here: `server-only`, the model provider, and the
 * `chatAgent.stream` spy that keeps the vector store out of the router tests.
 */

import { afterEach, beforeEach, vi } from 'vitest';

import { chatAgent } from '../../api/services/chat-agent';
import {
  chatModelStub,
  embedModelStub,
  respondWith,
} from './utils/provider-stubs';
import { cleanupTestData } from './utils/test-context';

// Mock server-only module - allows importing server components in vitest
vi.mock('server-only', () => ({}));

// The provider stand-ins are built in `./utils/provider-stubs`, an ordinary
// module, and only re-exported here so the existing `from '../../setup'`
// imports keep working. Their placement is load-bearing and explained there:
// `isolate: false` re-evaluates a setup file per test file, so stubs built HERE
// existed once per file while the `@acme/models` mock kept only the first set.
export {
  chatModelStub,
  embedModelStub,
  respondWith,
} from './utils/provider-stubs';

// The provider fake is rag's (`@acme/rag/testing`) rather than a copy: both
// suites embed against the same pgvector store, so the dimension and the
// provider-options shape have to agree or the upsert fails rather than the
// assertion. This suite needs the embed half because
// `retrieval-tool-scope.test.ts` executes the retrieval tool for real, which
// embeds the seeded Documents and the query.
//
// `chatModel` is a mock too, not the real client. Every test either streams
// through the `vi.spyOn` stub below or drives the agent against
// `chatModelStub` — nothing is supposed to reach Bedrock, and a stand-in makes
// that structural rather than a property of how the tests happen to be written.
//
// The factory is hoisted above every import in this file, so it reaches the
// stubs through a dynamic `import()` rather than a module-scope binding that
// would still be in its temporal dead zone. Because the target is a plain
// module, that import resolves to the same instances the test files hold.
vi.mock('@acme/models', async () => {
  const [stubs, ragTesting] = await Promise.all([
    import('./utils/provider-stubs'),
    import('@acme/rag/testing'),
  ]);
  return ragTesting.fakeModelsModule({
    chatModel: stubs.chatModelStub,
    embedModel: stubs.embedModelStub,
  });
});

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
      // await keeps this a genuine async stream (chunks arrive over the wire).
      for (const chunk of chunks) yield await Promise.resolve(chunk);
    })(),
  );
}

export function throwingAgentStream(chunks: string[], error: Error) {
  return asAgentStream(
    (async function* () {
      for (const chunk of chunks) yield await Promise.resolve(chunk);
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

// Clean up after each test.
//
// The provider state is reset HERE and not in `beforeEach`, and the reason is
// worth knowing: the backend project runs `isolate: false` in one forked worker
// (`@acme/test-utils`), so a setup hook is not reliably ordered before a test
// file's own — teardown is. Resetting on the way in would silently undo a
// file's `respondWith(...)`, which is how this file was wrong once: the
// provider then answered nothing, the call log was empty, and every assertion
// about "no tools were offered" passed vacuously.
afterEach(async () => {
  respondWith(null);
  chatModelStub.doStreamCalls.length = 0;
  embedModelStub.doEmbedCalls.length = 0;

  try {
    await cleanupTestData();
  } catch {
    // Ignore cleanup errors (DB might not be connected in some test scenarios)
  }
});
