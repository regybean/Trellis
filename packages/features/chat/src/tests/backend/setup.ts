/**
 * Backend Test Setup
 *
 * Runs before each test file (after `@acme/test-utils/hydrate-env`, which has
 * populated `process.env` with the testcontainer DB/Redis details). Every
 * `env.ts` validates against the real running services — no env mocks. Only
 * behavioral mocks live here: `server-only`, the model provider, and the
 * `chatAgent.stream` spy that keeps the vector store out of the router tests.
 */

import type { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, vi } from 'vitest';

import type * as RagTesting from '@acme/rag/testing';

import { chatAgent } from '../../api/services/chat-agent';
import { cleanupTestData } from './utils/test-context';

type ChatModelStub = InstanceType<typeof MockLanguageModelV3>;
type Streamed = Awaited<ReturnType<ChatModelStub['doStream']>>;

interface ProviderFakes {
  chatModelStub: ChatModelStub;
  embedModelStub: ReturnType<typeof RagTesting.fakeEmbedModel>;
  fakeModelsModule: typeof RagTesting.fakeModelsModule;
  respondWith: (next: (() => Streamed) | null) => void;
}

declare global {
  /**
   * The provider fakes, pinned to the WORKER rather than to one execution of
   * this file. See the note on `vi.hoisted` below for why that distinction is
   * load-bearing; `globalThis` is the only scope that outlives a single setup
   * execution while still dying with the worker.
   */

  var chatProviderFakes: ProviderFakes | undefined;
}

// Mock server-only module - allows importing server components in vitest
vi.mock('server-only', () => ({}));

/**
 * The provider stand-ins, built before the module mock that installs them.
 *
 * `vi.hoisted` is what makes them reachable from BOTH the factory below (which
 * is itself hoisted above every import) and the test files that import this
 * module — a plain `const` would be in its temporal dead zone when the factory
 * runs. The imports are dynamic for the same reason.
 *
 * Both are recording mocks. `chatModelStub.doStreamCalls` is what the provider
 * was actually asked for — the tool list, the messages — and
 * `embedModelStub.doEmbedCalls` is whether a query embedding was computed at
 * all. That is the honest observation point for `streamScopedTurn`'s contract:
 * the LLM is a true external, so what reaches it is an outcome, where reading
 * the arguments of a stubbed in-repo method would only be the mechanism.
 *
 * A test chooses what the provider answers with through `respondWith`, NOT by
 * reassigning `chatModelStub.doStream`: the constructor wraps the function it
 * is handed in the recorder that appends to `doStreamCalls`, so overwriting the
 * field throws the recording away and leaves every assertion about it vacuously
 * green. Unset, the provider throws — a file that reaches the model without
 * meaning to should say so rather than return something plausible.
 *
 * Built ONCE PER WORKER, and that is the whole reason for the `globalThis`
 * handoff. A setup file re-executes for every test file, but the backend
 * project runs `isolate: false` (`@acme/test-utils`), so the modules it mocks
 * do NOT: `chat-agent.ts` is evaluated by whichever test file imports it first
 * and stays cached, holding the `chatModel` that execution's `vi.mock` factory
 * handed it. Fresh stubs on the second execution would therefore be written by
 * the test and read by nobody — the agent would still be streaming through the
 * FIRST file's stub, so `respondWith(...)` would set a response the provider
 * never consults and `doStreamCalls` would stay empty however many times the
 * model was asked. That is not hypothetical: it is exactly how
 * `chat-turn-stream.test.ts` failed whenever the file sequencer did not happen
 * to run it first. Pinning the fakes to the worker makes the stub the agent
 * captured and the stub a test can reach the same object, in any file order.
 */
const { chatModelStub, embedModelStub, fakeModelsModule, respondWith } =
  await vi.hoisted(async (): Promise<ProviderFakes> => {
    if (globalThis.chatProviderFakes) return globalThis.chatProviderFakes;

    const { MockLanguageModelV3 } = await import('ai/test');
    const ragTesting = await import('@acme/rag/testing');

    let response: (() => Streamed) | null = null;

    const fakes: ProviderFakes = {
      chatModelStub: new MockLanguageModelV3({
        doStream: () => {
          if (!response) {
            throw new Error(
              'The chat provider was called with no response configured. Either the test meant to stream through the chatAgent.stream stub, or it needs respondWith(...).',
            );
          }
          return Promise.resolve(response());
        },
      }),
      embedModelStub: ragTesting.fakeEmbedModel(),
      fakeModelsModule: ragTesting.fakeModelsModule,
      respondWith: (next: (() => Streamed) | null) => {
        response = next;
      },
    };

    globalThis.chatProviderFakes = fakes;
    return fakes;
  });

export { chatModelStub, embedModelStub, respondWith };

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
vi.mock('@acme/models', () =>
  fakeModelsModule({ chatModel: chatModelStub, embedModel: embedModelStub }),
);

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
// The provider state is reset HERE and not in `beforeEach`, and with the fakes
// pinned to the worker the reason is structural: they now outlive any one
// execution of this file, so teardown is the only hook that can keep test
// files independent of each other. Resetting on the way in instead would undo
// the `respondWith(...)` a test's own `beforeEach` had already set, leaving the
// provider with nothing to answer and an empty call log — which every "no tools
// were offered" assertion passes vacuously against.
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
