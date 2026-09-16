import { stepCountIs } from 'ai';

import { resolveRetrievalScope } from '@acme/rag/server';

import { chatAgent } from './chat-agent';

/**
 * The one and only `chatAgent.stream` call site.
 *
 * Sole, and lint-enforced: chat's ESLint config bans the call everywhere but
 * this file. That is what makes the privacy boundary structural rather than
 * remembered — Mastra's retrieval tool is fail-OPEN by construction (no filter
 * in the request context means `enableFilter: false` and a full-corpus read),
 * so a second `stream` call that forgot its scope would leak every user's
 * chunks silently. There is nothing to remember here: a Turn cannot be streamed
 * without going through this function, and this function cannot build a scope
 * without asserting ownership.
 *
 * The ban covers the CALL, not the `chatAgent` import, so Studio registration
 * and the backend suite's `vi.spyOn` stub both still work. Its one known gap:
 * the selector matches the identifier, so aliasing the import
 * (`import { chatAgent as a }`) defeats it. Accepted — an import ban would have
 * to whitelist all of `tests/**`, which reopens the hole for any future test
 * that streams for real.
 */

/**
 * The step budget for one Turn, pinned here rather than inherited.
 *
 * Mastra's default is already `stepCountIs(5)`, so this changes nothing today —
 * that is the point. `stopWhen` bounds how many times the agent may call the
 * retrieval tool before its final text step, which sets retrieval breadth,
 * worst-case latency and worst-case prompt size. Those are ours to own, not a
 * transitive dependency's to move under us on a version bump. `topK` bounds one
 * tool call; this bounds how many tool calls a Turn gets, so a Turn retrieves
 * up to roughly four searches' worth. Retuning the value is out of scope.
 */
const TURN_STEP_BUDGET = 5;

export interface ScopedTurn {
  conversationId: string;
  userId: string;
  query: string;
  /**
   * The Data Sources this Turn may retrieve from. Raw, not pre-validated:
   * `resolveRetrievalScope` re-asserts ownership itself, which is what closes
   * the delete-while-in-flight case — a Source deleted between `chat.send` and
   * this call is simply not in scope.
   */
  dataSourceIds: string[];
}

export async function streamScopedTurn({
  conversationId,
  userId,
  query,
  dataSourceIds,
}: ScopedTurn) {
  const { requestContext, hasSources } = await resolveRetrievalScope({
    ownerId: userId,
    dataSourceIds,
  });

  return chatAgent.stream(query, {
    // readOnly: true — Mastra recalls context but does NOT auto-persist the
    // user or assistant turn. The worker persists the assistant message
    // explicitly on terminal, so it controls the messageId and the timing.
    memory: {
      thread: conversationId,
      resource: userId,
      options: { readOnly: true },
    },
    // An empty VALIDATED scope offers the agent no retrieval tool at all, which
    // costs no query embedding, no scan and fewer prompt tokens — and the empty
    // set is both the default and sticky, so this is the common path. Mastra
    // applies `activeTools` with a null check rather than a length check, so
    // `[]` yields zero tools; it does not degrade into "all tools" the way an
    // empty filter degrades into "no filtering".
    //
    // `hasSources` comes from rag's validated scope and must NOT be recomputed
    // from `dataSourceIds` here. A Source deleted since `chat.send` is dropped
    // by the re-assert, so the raw array can be non-empty while the validated
    // scope is empty — counting the raw input would attach the tool to a Turn
    // that can retrieve nothing.
    //
    // Safe in both directions: a wrong `[]` means retrieval silently does not
    // happen (a degraded answer, fail-closed), a wrong `undefined` means a
    // round trip that was previously accepted. Neither leaks, because the
    // filter below is built and validated unconditionally either way. This is a
    // performance branch sitting above an unbranched privacy boundary.
    activeTools: hasSources ? undefined : [],
    // The trusted object, assembled by rag, passed through untouched. Chat sets
    // no keys on it: the agent is deliberately never told its retrieval scope,
    // in either the empty or the non-empty case.
    requestContext,
    stopWhen: stepCountIs(TURN_STEP_BUDGET),
  });
}
