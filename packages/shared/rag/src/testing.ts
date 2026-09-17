/**
 * rag test helpers — shipped as the `@acme/rag/testing` export subpath.
 *
 * The `@acme/models` stand-in, owned once. Any suite that embeds for real needs
 * it: rag's own, because `uploadDoc` writes vectors to pgvector, and chat's,
 * because `retrieval-tool-scope.test.ts` drives the retrieval tool against that
 * same store. Two hand-copied fakes is two chances for the dimension or the
 * provider-options shape to drift from what the schema sizes its column with.
 *
 * The LLM/embedding provider is a true external, so faking it is the blessed
 * kind of mock (docs/agents/testing.md, rule 1) — no in-repo seam is stubbed
 * here. Prod code never imports this subpath.
 */
import { MockEmbeddingModelV3 } from 'ai/test';

import { EMBED_DIMENSIONS } from './schemas/documents-schema';

/**
 * An embed model that returns an IDENTICAL, dimension-correct vector for every
 * value, and that is load-bearing rather than lazy.
 *
 * Every chunk ends up equidistant from every query, so the `ORDER BY … LIMIT
 * topK` cut among perfect ties is arbitrary and nothing but the FILTER can
 * decide what comes back. The privacy claims the retrieval suites make
 * therefore never rest on relevance ranking being stable. Dedup keys on the
 * content-derived id and never on the embedding, so the fixed vector costs the
 * uploader suite nothing either.
 *
 * The dimension comes from `EMBED_DIMENSIONS` rather than a literal, so it is
 * the same number `documents-schema` sizes the vector column and the PgVector
 * index with — a mismatch would fail the upsert, not the assertion.
 */
export const fakeEmbedModel = () =>
  new MockEmbeddingModelV3({
    doEmbed: ({ values }: { values: string[] }) =>
      Promise.resolve({
        embeddings: values.map(() =>
          Array.from({ length: EMBED_DIMENSIONS }, () => 0.1),
        ),
        warnings: [],
      }),
  });

/**
 * The whole `@acme/models` module as a suite should see it, ready to return
 * from a `vi.mock('@acme/models', …)` factory.
 *
 * No overload of this ever hands back a REAL model: the provider is the one
 * thing a test may not reach, and a fake assembled per-suite is a fake that can
 * forget. rag needs neither language model and takes the `{}` placeholders;
 * chat substitutes both halves for recording mocks, because its suite drives
 * the agent for real and then reads what the provider was asked for.
 *
 * `embedModel` is a parameter rather than always-fresh so a caller can keep the
 * handle and interrogate `doEmbedCalls` — "no query embedding was computed" is
 * an assertion only the instance itself can settle.
 */
export const fakeModelsModule = ({
  chatModel = {},
  titleModel = {},
  embedModel = fakeEmbedModel(),
}: {
  chatModel?: unknown;
  titleModel?: unknown;
  embedModel?: ReturnType<typeof fakeEmbedModel>;
} = {}) => ({
  chatModel,
  titleModel,
  embedModel,
  embedProviderOptions: () => ({}),
});
