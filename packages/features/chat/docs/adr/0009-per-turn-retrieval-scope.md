# Retrieval is scoped per Turn, through one lint-enforced call site

**Status:** accepted

**Related:** [ADR 0004](0004-generation-worker-and-queue.md) (the worker that streams the Turn), [@acme/rag ADR 0005](../../../../shared/rag/docs/adr/0005-retrieval-scope-narrows-rather-than-rejects.md) (the narrowing policy this rides on).

## Context

Mastra's vector-query tool is fail-**open**. A `stream` call that carries no
`filter` in its request context resolves `enableFilter: false` and retrieves
over the whole corpus — silently, with a plausible answer at the end of it. With
one shared knowledge base that was merely unscoped; with per-user **Data
Sources** it is a cross-user read.

So the guarantee cannot be "remember to pass a scope". Anything a reviewer has
to notice is something a reviewer will eventually not notice, and the failure is
invisible in the output. This ADR records the four decisions that make the scope
structural, all of which were previously only file comments.

## Decision

**1. `chatAgent.stream` has exactly one call site, and ESLint enforces it.**

`streamScopedTurn` (`api/services/chat-turn-stream.ts`) is the only place the
agent is streamed. A `no-restricted-syntax` selector in chat's `eslint.config.ts`
bans the call everywhere else, with a `files` override exempting the wrapper. A
Turn cannot be streamed without going through the function, and the function
cannot build a scope without resolving ownership — so there is nothing left to
remember.

The ban covers the **call**, not the `chatAgent` import: Studio registration
imports the agent and never streams, and the backend suite's `vi.spyOn(chatAgent,
'stream')` is not a matching call expression. The known gap is that the selector
matches an identifier, so `import { chatAgent as agent }` defeats it. Accepted:
closing it needs type-aware linting, and an import ban would have to whitelist
all of `tests/**`, which reopens the hole for any future test that streams for
real. The override re-carries `banConsole` (imported from
`@acme/eslint-config/base`, not restated) because flat config replaces rule
options rather than merging them.

**2. `chat.send` narrows the Source Selection; it does not reject it.**

The selection is intersected with the caller's own Sources through rag's
`ownedDataSourceIds`, and the rest are dropped with a log line. The policy and
its reasoning are rag's ([ADR 0005]); what is chat's is that the narrowed set is
what goes on the per-Turn record and into the `GenerationJob` payload, so the
job states what actually applied. The worker does not trust it — `streamScopedTurn`
narrows again at use — because a brand proving "already checked" would not
survive BullMQ's JSON boundary anyway, and the two passes answer different
questions: "which of these are yours?" at send, "which are still yours?" at run.

**3. An empty validated scope gets `activeTools: []`, not a filtered query.**

The empty set is the default and it is sticky, so it is the common path. Offering
the agent no retrieval tool at all costs no query embedding, no scan, and fewer
prompt tokens. Mastra applies `activeTools` with a null check rather than a
length check, so `[]` yields zero tools — it does not degrade into "all tools"
the way an empty filter degrades into "no filtering".

Two things make this safe to treat as an optimisation rather than a second
boundary. The branch reads `hasSources` from rag's **narrowed** scope, never from
chat's raw array, so a Turn whose Sources were all deleted is correctly treated
as empty. And the filter below it is built and validated unconditionally either
way: a wrong `[]` is a degraded answer, a wrong `undefined` is a round trip that
retrieves nothing. Neither leaks. This is a performance branch sitting above an
unbranched privacy boundary.

**4. The step budget is pinned at the call site: `stopWhen: stepCountIs(5)`.**

`stopWhen` bounds how many times the agent may call the retrieval tool before its
final text step, which sets retrieval breadth, worst-case latency and worst-case
prompt size. Five is Mastra's current default, so this changes nothing today —
that is the point. It is a change of authority, not of tuning: those numbers are
ours, not a transitive dependency's to move on a version bump.

## Considered and rejected

- **Trust the job payload and skip the re-narrow in the worker.** One indexed
  read against a table capped at ten rows per user, against a window of minutes
  in which a Source can be deleted. Rejected — the read is free and the window
  is not theoretical.
- **Reject a selection containing an unowned id with `FORBIDDEN`.** See [ADR
  0005]; the short version is that rejecting makes ordinary staleness cost the
  user their message.
- **Let the agent author its own `filter`.** `enableFilter` is deliberately left
  off the tool, so `filter` never enters the LLM-facing schema. The model cannot
  author the privacy boundary, and a request-context filter self-enables
  filtering anyway. There is no trade here.
- **Ban the `chatAgent` import rather than the call.** Would have to whitelist
  the whole test tree and Studio registration. Rejected — see above.
- **Leave `stopWhen` to Mastra's default.** Rejected: a silent change to
  retrieval breadth and prompt size is exactly the kind of thing that should
  show up in a diff.

## Consequences

- Adding a second streaming entry point is a lint failure, not a review catch.
  Someone who genuinely needs one has to extend `streamScopedTurn` or add a
  second `files` override, and the override is visible in the config.
- `chatAgent` carries `requestContextSchema: retrievalContextSchema` (rag's), so
  a Turn that reaches the agent with no context throws
  `AGENT_REQUEST_CONTEXT_VALIDATION_FAILED` before any LLM call rather than
  retrieving over everything. That backstop is validated on the agent's
  `stream`/`generate` path only — Mastra workflow steps have separate handling
  behind a `validateInputs` flag the agent path lacks. There are no workflows
  today; if anything ever wraps this agent in one, the coverage must be
  rechecked.
- Studio cannot run the chat agent without a valid retrieval context, which is
  why `pnpm studio` passes `--request-context-presets ./presets.json`. The preset's
  owner is fake and its `$in` empty, so Studio retrieves nothing by construction.
- `streamScopedTurn`'s contract is tested at the **provider**, not at a stubbed
  `chatAgent.stream`: the suite drives the real agent against a recording
  `MockLanguageModelV3` and asserts what the model was offered. One clause stays
  unproven and is named in the test file — that a live provider accepts an empty
  `tools` array.

[ADR 0005]: ../../../../shared/rag/docs/adr/0005-retrieval-scope-narrows-rather-than-rejects.md
