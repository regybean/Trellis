/**
 * What the model provider is actually asked for when a Turn streams.
 *
 * This file drives the REAL `chatAgent.stream` — it restores the stub the suite
 * installs — against a recording provider, and asserts on what arrived there.
 * The wrapper's job is to bound a Turn (no retrieval tool when the scope is
 * empty, the tool when it is not, five steps and no more), and every one of
 * those is observable at the provider, which is a true external. Reading the
 * arguments of a stubbed `chatAgent.stream` instead would be asserting the
 * mechanism — the same thing `expect(mock).toHaveBeenCalledWith(...)` does,
 * spelled differently — and chat owns that seam.
 *
 * Postgres is real throughout, because the `activeTools` branch is driven by
 * rag's NARROWED scope and not by the raw input: a Source that no longer exists
 * has to actually fall out, which a fake would not reproduce.
 *
 * One clause of the empty-scope claim stays out of reach here and is honest
 * about it: that the live chat provider accepts an empty `tools` array. That
 * needs a live provider. The other two clauses — Mastra turning `activeTools:
 * []` into zero tools rather than all tools, and no query embedding being
 * computed — were read-the-source claims and are now assertions below.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataSource, deleteDataSource } from '@acme/rag/server';

import { chatAgent } from '../../../../api/services/chat-agent';
import { createConversation } from '../../../../api/services/chat-memory';
import { streamScopedTurn } from '../../../../api/services/chat-turn-stream';
import { chatModelStub, embedModelStub, respondWith } from '../../setup';
import { createTestSessionId, createTestUserId } from '../../utils/fixtures';

// The stream a provider hands back, named off the mock rather than imported
// from `@ai-sdk/provider` — chat does not depend on that package, and deriving
// the type keeps this file honest if the SDK's part shape moves.
type StreamResult = Awaited<ReturnType<typeof chatModelStub.doStream>>;
type StreamPart =
  StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never;

const USAGE = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function streamOf(parts: StreamPart[]): StreamResult {
  return {
    stream: new ReadableStream<StreamPart>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

// A provider that answers in one step and stops. The default for every case
// that is not about the step budget.
function answersOnce(): StreamResult {
  return streamOf([
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: '0' },
    { type: 'text-delta', id: '0', delta: 'Answered.' },
    { type: 'text-end', id: '0' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: USAGE,
    },
  ]);
}

// A provider that never stops asking to retrieve. Only `stopWhen` can end a
// Turn driven by this, which is what makes the step budget measurable.
function alwaysRetrieves(): StreamResult {
  return streamOf([
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: crypto.randomUUID(),
      toolName: 'vectorQuery',
      input: JSON.stringify({ queryText: 'anything at all', topK: 1 }),
    },
    {
      type: 'finish',
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: USAGE,
    },
  ]);
}

// The tool names the provider was offered on the Turn's first step.
//
// It THROWS when the provider was never asked, rather than reporting an empty
// list. "No tools" and "no call" are the same `[]` otherwise, and every
// empty-scope assertion in this file would pass on a Turn that never reached the
// model at all — which is exactly how this helper was wrong the first time it
// was written. Absent and empty `tools` do collapse into `[]`: both answer "was
// the model given anything to retrieve with?" with no.
function toolsOffered() {
  const [firstCall] = chatModelStub.doStreamCalls;
  if (!firstCall) {
    throw new Error('the Turn never reached the provider');
  }
  return (firstCall.tools ?? []).map((tool) => tool.name);
}

describe('streamScopedTurn (integration)', () => {
  // Every Source this file creates, swept after each case. Owner-scoped rather
  // than wholesale: a sibling suite file seeds a corpus in `beforeAll` that a
  // blanket truncation would pull out from under it.
  let created: { ownerId: string; id: string }[] = [];
  let userId = '';
  let conversationId = '';

  beforeEach(async () => {
    userId = createTestUserId();
    conversationId = createTestSessionId();
    created = [];

    // Undo the suite-wide `chatAgent.stream` stub for this file only. Calling
    // `vi.spyOn` on an already-spied method hands back the SAME spy the shared
    // setup installed, so restoring it here puts the real implementation back
    // — which is the whole point: the agent has to run for the provider to be
    // asked anything.
    vi.spyOn(chatAgent, 'stream').mockRestore();

    respondWith(answersOnce);

    // Mastra recalls the thread on every Turn (`readOnly: true` recalls without
    // persisting), so it has to exist before the agent runs.
    await createConversation(conversationId, userId);
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

  // Run a Turn to completion. The provider is only asked for anything once the
  // stream is consumed, so nothing here may skip the drain.
  async function runTurn(dataSourceIds: string[]) {
    const result = await streamScopedTurn({
      conversationId,
      userId,
      query: 'What do my notes say?',
      dataSourceIds,
    });

    let text = '';
    for await (const chunk of result.textStream) text += chunk;
    return text;
  }

  it('offers the model no tool at all when the validated scope is empty', async () => {
    await runTurn([]);

    // Not "activeTools was []" — that is the instruction. This is the
    // consequence: Mastra applies `activeTools` with a null check rather than a
    // length check, so an empty array yields zero tools instead of degrading
    // into all of them the way an empty filter degrades into no filtering.
    expect(toolsOffered()).toEqual([]);
  });

  it('computes no query embedding when the validated scope is empty', async () => {
    await runTurn([]);

    // The other half of what the empty-scope shortcut buys. With no retrieval
    // tool there is nothing to embed a query for, so the Turn costs no embed
    // round trip and no vector scan.
    expect(embedModelStub.doEmbedCalls).toHaveLength(0);
  });

  it('offers the retrieval tool when the validated scope is non-empty', async () => {
    await seedSource('Work');

    await runTurn([await seedSource('Notes')]);

    expect(toolsOffered()).toContain('vectorQuery');
  });

  it('drops a Source deleted after the send and still answers', async () => {
    // The delete-while-in-flight case, and it is not a race: the narrowing
    // inside `resolveRetrievalScope` runs when the Turn actually executes, so
    // there is no interleaving to arrange — delete, then stream. Losing the
    // Source must not lose the message.
    const doomed = await seedSource('Temporary');
    await deleteSource(doomed);

    await expect(runTurn([doomed])).resolves.toBe('Answered.');
    // Nothing left to retrieve from, so the Turn is offered no tool — the
    // narrowed scope decides this, not the non-empty array that was passed in.
    expect(toolsOffered()).toEqual([]);
  });

  it('keeps the surviving Sources when only some of the selection was deleted', async () => {
    const kept = await seedSource('Work');
    const doomed = await seedSource('Temporary');
    await deleteSource(doomed);

    await runTurn([kept, doomed]);

    expect(toolsOffered()).toContain('vectorQuery');
  });

  it('stops the Turn at the pinned step budget rather than an inherited one', async () => {
    const mine = await seedSource('Work');
    respondWith(alwaysRetrieves);

    await runTurn([mine]);

    // Five, because `streamScopedTurn` pins `stepCountIs(5)`. The value is
    // Mastra's current default on purpose — this is a change of authority, not
    // of tuning — so the assertion is that a dependency bump cannot silently
    // move retrieval breadth, latency and worst-case prompt size. A model that
    // never stops asking makes the budget the only thing that can end the Turn.
    expect(chatModelStub.doStreamCalls).toHaveLength(5);
  });
});
