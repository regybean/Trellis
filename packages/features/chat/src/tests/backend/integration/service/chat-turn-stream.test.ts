/**
 * What `streamScopedTurn` hands the agent.
 *
 * The wrapper's entire job is to assemble one options object — a trusted
 * request context, the `activeTools` branch, the pinned step budget — so the
 * options ARE its contract, and the stubbed `chatAgent.stream` is where they
 * become observable. The LLM is a legitimately mocked external here (the whole
 * suite stubs it); this file reads what the wrapper passed through that stub
 * rather than counting calls on a seam the feature owns.
 *
 * Ownership runs for real against Postgres, because the `activeTools` branch is
 * driven by rag's VALIDATED scope and not by the raw input — a Source that no
 * longer exists has to actually fall out, which a fake would not reproduce.
 *
 * Two clauses of the empty-scope claim are deliberately NOT covered here, and
 * neither is provable with a stubbed model: that Mastra turns `activeTools: []`
 * into zero tools rather than all tools (a null check, not a length check, in
 * its loop), and that the live chat provider accepts an empty `tools` array.
 * Both were established by reading Mastra's source and are recorded in the
 * spec's accepted costs.
 */

import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataSource, deleteDataSource } from '@acme/rag/server';

import { chatAgent } from '../../../../api/services/chat-agent';
import { streamScopedTurn } from '../../../../api/services/chat-turn-stream';
import { createTestSessionId, createTestUserId } from '../../utils/fixtures';

// `Agent.stream` is overloaded, and its last overload takes one argument — so
// `mock.calls` types as a 1-tuple and the options are invisible to TypeScript.
// These two guards recover them without a cast: neither claims more than it
// checks.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasGet(
  value: unknown,
): value is { get: (this: void, key: string) => unknown } {
  return isRecord(value) && typeof value.get === 'function';
}

// A bound handle on the shared `chatAgent.stream` stub, refreshed each test.
let streamSpy: MockInstance;

// The options the wrapper passed, read off the stub the suite already installs.
// `streamSpy` is a handle on that same stub, held so the method is never
// referenced unbound.
function optionsPassedToStream() {
  const calls: unknown[][] = streamSpy.mock.calls;
  const options = calls[0]?.[1];
  if (!isRecord(options)) {
    throw new Error('chatAgent.stream was called without stream options');
  }
  return options;
}

// The trusted context the wrapper passed through, ready to interrogate.
function contextPassedToStream() {
  const { requestContext } = optionsPassedToStream();
  if (!hasGet(requestContext)) {
    throw new Error('chatAgent.stream was called without a request context');
  }
  return requestContext;
}

describe('streamScopedTurn (integration)', () => {
  // Every Source this test created, swept after each case. Owner-scoped rather
  // than wholesale: a sibling suite file seeds a corpus in `beforeAll` that a
  // blanket truncation would pull out from under it.
  let created: { ownerId: string; id: string }[] = [];
  let userId = '';
  let conversationId = '';

  beforeEach(() => {
    userId = createTestUserId();
    conversationId = createTestSessionId();
    created = [];
    // Re-entering `vi.spyOn` on an already-spied method hands back the SAME
    // spy the shared setup installed (with its default streamed response), so
    // this only takes a bound handle on it — it does not replace the stub.
    streamSpy = vi.spyOn(chatAgent, 'stream');
  });

  afterEach(async () => {
    for (const source of created) {
      await deleteDataSource(source);
    }
    created = [];
  });

  async function seedSource(name: string) {
    const source = await createDataSource({
      ownerId: userId,
      id: crypto.randomUUID(),
      name,
    });
    created.push({ ownerId: userId, id: source.id });
    return source.id;
  }

  // Drop a Source mid-test, keeping the sweep list honest so teardown does not
  // try to delete it twice.
  async function deleteSource(id: string) {
    await deleteDataSource({ ownerId: userId, id });
    created = created.filter((source) => source.id !== id);
  }

  const stream = (dataSourceIds: string[]) =>
    streamScopedTurn({
      conversationId,
      userId,
      query: 'What do my notes say?',
      dataSourceIds,
    });

  it('offers no retrieval tool when the validated scope is empty', async () => {
    await stream([]);

    // `[]`, not `undefined`: an empty scope means retrieve nothing, so the Turn
    // costs no query embedding, no scan and fewer prompt tokens. This is the
    // default and sticky state, so it is the common path.
    expect(optionsPassedToStream().activeTools).toEqual([]);
  });

  it('offers the retrieval tool when the validated scope is non-empty', async () => {
    const mine = await seedSource('Work');

    await stream([mine]);

    // `undefined` leaves the agent's own tool set in force.
    expect(optionsPassedToStream().activeTools).toBeUndefined();
  });

  it('refuses to stream a Turn whose Source was deleted after the send', async () => {
    // The delete-while-in-flight case, and it is not a race: the re-assert
    // inside `resolveRetrievalScope` runs when the Turn actually executes, so
    // there is no interleaving to arrange — delete, then call.
    //
    // It THROWS rather than quietly narrowing, which is why `activeTools` is
    // not asserted here. The worker's catch turns that into an `error`
    // terminal and a refund, so the failure is loud and paid back. Fail-closed
    // either way: nothing is retrieved from a Source that no longer exists.
    const doomed = await seedSource('Temporary');
    await deleteSource(doomed);

    await expect(stream([doomed])).rejects.toThrow();
  });

  it('passes a trusted context carrying the caller as owner and the pinned topK', async () => {
    const mine = await seedSource('Work');

    await stream([mine]);

    const requestContext = contextPassedToStream();
    expect(requestContext.get('filter')).toEqual({
      owner_id: userId,
      data_source_id: { $in: [mine] },
    });
    // Server-pinned, so retrieval never falls back to an LLM-authored value.
    expect(requestContext.get('topK')).toBe(10);
  });

  it('builds the filter unbranched, so an empty scope is $in: [] and not a missing filter', async () => {
    await stream([]);

    // The `activeTools` shortcut above means this never reaches Postgres — but
    // it is still built and still validated, so if that optimisation is ever
    // dropped this is what still fails closed. An empty OBJECT filter would
    // instead read as "enable filtering, then drop the empty filter" and run
    // unfiltered.
    expect(contextPassedToStream().get('filter')).toEqual({
      owner_id: userId,
      data_source_id: { $in: [] },
    });
  });

  it('pins the step budget at the call site rather than inheriting a default', async () => {
    await stream([]);

    // The value is Mastra's current default on purpose — this is a change of
    // authority, not of tuning. What matters is that a dependency bump cannot
    // silently move retrieval breadth, latency and worst-case prompt size.
    expect(optionsPassedToStream().stopWhen).toBeDefined();
  });
});
