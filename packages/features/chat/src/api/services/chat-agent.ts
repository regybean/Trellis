import type { ToolsInput } from '@mastra/core/agent';
import type { z } from 'zod';
import { Agent } from '@mastra/core/agent';
import { createVectorQueryTool } from '@mastra/rag';

import { chatModel, embedModel, embedProviderOptions } from '@acme/models';
import { indexName, memory, pgVector } from '@acme/rag';
import { retrievalContextSchema } from '@acme/rag/server';

import { getAppInfo } from '../../data/app-info';
import { env } from '../../env';

// The request-context shape this agent validates, derived from rag's schema so
// it cannot drift from it. Named only to pass as `Agent`'s `TRequestContext`
// below: `requestContextSchema` makes that parameter concrete, and its
// `unknown` default no longer describes this agent.
type RetrievalContext = z.infer<typeof retrievalContextSchema>;

// Retrieval over the knowledge base. The agent calls this tool to ground its
// answers; the query is embedded by the active embed provider, with any
// provider-specific options (e.g. Cohere's `search_query` input type) applied.
//
// No `topK` is passed, and that is deliberate — do not "fix" it. `topK` sits in
// this tool's LLM-facing input schema unconditionally and cannot be removed, so
// the model authors a number on every call. The request context discards it:
// the tool resolves `requestContext.get('topK') ?? inputData.topK ?? 10`, and
// `streamScopedTurn` always supplies a context carrying a server-pinned `topK`.
// Passing one here would set the fallback for a call that never reaches the
// fallback. The model's vestigial `topK` is left alone rather than suppressed,
// because overriding `description` to drop it means owning a forked copy of
// Mastra's tool prompt — which also carries the query-text guidance — and
// re-syncing it on every upgrade, to shave a few tokens off a discarded field.
//
// `enableFilter` is likewise absent on purpose. Leaving it off keeps `filter`
// out of the LLM-facing schema entirely, so the model cannot author the privacy
// boundary; a request-context `filter` takes precedence over tool input and
// self-enables filtering, so the filter still applies. There is no trade here.
//
// Module-private. `retrieval-tool-scope.test.ts` drives this tool directly
// against real pgvector, and reaches it through `chatAgent.listTools()` rather
// than an export: Mastra's inferred `RagTool` type is not nameable from outside
// its package, so exporting it fails declaration emit (TS2742).
const vectorQueryTool = createVectorQueryTool({
  vectorStore: pgVector,
  indexName,
  model: embedModel,
  providerOptions: embedProviderOptions('query'),
});

// The RAG chat assistant. Conversation history (last 15 turns) comes from Mastra
// Memory; relevant Documents come from the vector query tool.
//
// A SINGLETON, deliberately, and not a per-Turn factory. Studio registration
// (`src/mastra/index.ts`) and the backend suite's `vi.spyOn` LLM stub both
// legitimately need this object, and a factory has no `ownerId` at module scope
// — Studio could register only a placeholder and would then exercise a
// different object from the one production streams through.
//
// Scope reaches the agent per Turn instead, through the `RequestContext` that
// `streamScopedTurn` builds. `requestContextSchema` is that seam's backstop:
// Mastra validates it at the start of `stream`/`generate`, before any LLM call,
// so a Turn that forgot its context throws
// `AGENT_REQUEST_CONTEXT_VALIDATION_FAILED` instead of silently retrieving over
// every user's chunks (an absent filter yields `enableFilter: false` and a
// full-corpus read — the framework is fail-OPEN here). The schema is imported
// from rag rather than declared beside `new Agent()`: this is one wiring line
// with no domain knowledge in it, and a second expression of the filter's shape
// would fail toward an unvalidated filter when the two drift.
export const chatAgent = new Agent<
  string,
  ToolsInput,
  undefined,
  RetrievalContext
>({
  id: 'chat',
  name: 'chat',
  instructions: getAppInfo(env.NEXT_PUBLIC_WEBAPP).systemPrompt,
  model: chatModel,
  tools: { vectorQuery: vectorQueryTool },
  memory,
  requestContextSchema: retrievalContextSchema,
});
