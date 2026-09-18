import { MockLanguageModelV3 } from 'ai/test';

import { fakeEmbedModel } from '@acme/rag/testing';

/**
 * The provider stand-ins — and they live in an ORDINARY module rather than in
 * the setup file, which is the whole point of this file existing.
 *
 * The backend project runs `isolate: false` in one forked worker. That shares
 * the module graph across test files but re-evaluates each SETUP file once per
 * test file. Built in the setup file, these objects therefore existed once per
 * test file, while `vi.mock`'s `@acme/models` factory kept whichever pair the
 * FIRST evaluation produced. The stubs then silently split in two: the agent
 * streamed through file one's model, while a later file's `respondWith` armed
 * file two's response and its assertions read file two's call log. Both halves
 * look empty, so the symptom was "the Turn never reached the provider" — which
 * passed whenever the affected file happened to be scheduled first and failed
 * otherwise. Vitest orders files by cached duration, so which happened was not
 * stable from run to run.
 *
 * A plain module is evaluated once for the whole worker, so there is exactly
 * one of each and no ordering to get lucky with. It also removes the need for
 * `vi.hoisted`: the setup file's `vi.mock` factory reaches these through a
 * dynamic `import()`, which is legal inside a hoisted factory.
 *
 * Both are recording mocks. `chatModelStub.doStreamCalls` is what the provider
 * was actually asked for — the tool list, the messages — and
 * `embedModelStub.doEmbedCalls` is whether a query embedding was computed at
 * all. That is the honest observation point for `streamScopedTurn`'s contract:
 * the LLM is a true external, so what reaches it is an outcome, where reading
 * the arguments of a stubbed in-repo method would only be the mechanism.
 */

type Streamed = Awaited<ReturnType<MockLanguageModelV3['doStream']>>;

/**
 * What the provider answers with, chosen per test through `respondWith`.
 *
 * Unset, the provider throws. A file that reaches the model without meaning to
 * should say so rather than return something plausible.
 */
let response: (() => Streamed) | null = null;

/**
 * A test chooses the answer through `respondWith`, NOT by reassigning
 * `chatModelStub.doStream`: the constructor wraps the function it is handed in
 * the recorder that appends to `doStreamCalls`, so overwriting the field throws
 * the recording away and leaves every assertion about it vacuously green.
 */
export const chatModelStub = new MockLanguageModelV3({
  doStream: () => {
    if (!response) {
      throw new Error(
        'The chat provider was called with no response configured. Either the test meant to stream through the chatAgent.stream stub, or it needs respondWith(...).',
      );
    }
    return Promise.resolve(response());
  },
});

export const embedModelStub = fakeEmbedModel();

export function respondWith(next: (() => Streamed) | null) {
  response = next;
}
