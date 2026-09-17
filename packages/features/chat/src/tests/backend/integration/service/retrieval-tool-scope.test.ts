/**
 * Does rag's `RequestContext` actually override the retrieval tool's filter?
 *
 * Nothing else in the repo proves this middle link. rag's `retrieval-scope`
 * test proves the filter excludes correctly when handed straight to pgvector;
 * chat's router test proves the validated set reaches the job payload. Between
 * them sits an assumption established only by reading Mastra's source: that a
 * `filter` on the request context takes precedence over the tool's own input
 * and self-enables filtering. With `enableFilter` left off, the tool is
 * fail-OPEN by construction if that override does not land.
 *
 * This is not the forbidden "do not test the framework". Those examples all
 * fail loudly. This one fails silently and catastrophically: a Mastra bump that
 * changes `RequestContext` merging turns every Turn into a full-corpus read,
 * and nothing else in the suite notices. It pins OUR assumption about Mastra
 * rather than testing Mastra.
 *
 * The fixture shape is load-bearing, and the trap is worth spelling out. The
 * embed fake in `setup.ts` returns an IDENTICAL vector for every value, so
 * every chunk sits at the same distance from every query and the
 * `ORDER BY … LIMIT topK` cut among perfect ties is arbitrary. The obvious
 * formulation — "assert B's chunks are absent" — can therefore pass because
 * `topK` truncated them rather than because the filter excluded them, and on a
 * large enough corpus it is green with the filter removed entirely. So:
 *
 *   - Two users, three Sources, a KNOWN chunk count each, four chunks total,
 *     comfortably under `topK` (10), so nothing can be lost to truncation.
 *   - Assertions are positive and exhaustive — full set equality, never "does
 *     not contain B".
 *   - The identical-vector fake stays.
 *
 * Seeding goes through rag's production `createDataSource` and `uploadDoc`,
 * never a raw insert: a fixture with more power than production can lie in both
 * directions. Teardown goes through the production cascade for the same reason.
 *
 * Each file yields exactly one chunk (short text, `CHUNK_SIZE` 1024), so chunk
 * counts are controlled by the number of files rather than by text length.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  createDataSource,
  deleteDataSource,
  resolveRetrievalScope,
  uploadDoc,
} from '@acme/rag/server';

import { chatAgent } from '../../../../api/services/chat-agent';

// The trusted context's type, derived from rag rather than restated, so this
// file cannot describe a shape rag has stopped producing.
type TrustedContext = Awaited<
  ReturnType<typeof resolveRetrievalScope>
>['requestContext'];

/**
 * Mastra's tool registry is typed `any` at the edges (`listTools()` hands back
 * `ToolsInput`, whose `execute` output is `any`), so the tool is narrowed with
 * a guard and its output parsed with zod instead of cast. The guard states the
 * two things this test actually depends on: the tool is callable, and it takes
 * a request context.
 */
interface ExecutableRetrievalTool {
  execute: (
    input: { queryText: string; topK: number },
    context: { requestContext: TrustedContext },
  ) => Promise<unknown>;
}

function isExecutable(tool: unknown): tool is ExecutableRetrievalTool {
  return (
    typeof tool === 'object' &&
    tool !== null &&
    'execute' in tool &&
    typeof tool.execute === 'function'
  );
}

/**
 * A deliberately WRONG `topK`, standing in for the one the model authors.
 *
 * `topK` is required by the tool's input schema and cannot be removed from it,
 * so in production the model supplies a number on every call — passing none
 * here is not "like production", it is an input-validation failure. Setting it
 * to 1 turns that nuisance into a second assertion: the corpus below gives A1
 * two chunks, so every expectation of two proves the request context's `topK`
 * (10) overrode this one. If the context's `topK` ever stops being read,
 * retrieval silently reverts to an LLM-authored value and these tests go red.
 */
const MODEL_AUTHORED_TOPK = 1;

// Only the slice of the tool's output this test reads. `file_name` is the
// metadata key `uploadDoc` stamps, so a rename breaks here loudly rather than
// silently returning `"undefined"` for every row.
const toolOutputSchema = z.object({
  sources: z.array(
    z.object({ metadata: z.object({ file_name: z.string() }).loose() }),
  ),
});

function txtFile(name: string) {
  return new File([`Content of ${name} worth chunking.`], name, {
    type: 'text/plain',
  });
}

// Retrieval order among perfect ties is arbitrary, so both sides of every set
// comparison are sorted the same way.
const sorted = (fileNames: string[]) =>
  fileNames.toSorted((a, b) => a.localeCompare(b));

/**
 * Retrieve through the agent's OWN tool, driven the way Mastra drives it.
 *
 * The tool comes off `chatAgent.listTools()` rather than being rebuilt here —
 * the point is that the tool the agent actually holds (our `indexName`, our
 * embed model, `enableFilter` left off) honours the context rag builds. The
 * `queryText` is deliberately unrelated to the seeded content: with the
 * identical-vector fake it cannot matter, and if it ever starts mattering this
 * test should be the thing that notices.
 */
async function retrieveThroughTool(ownerId: string, dataSourceIds: string[]) {
  const { requestContext } = await resolveRetrievalScope({
    ownerId,
    dataSourceIds,
  });

  const tools: Record<string, unknown> = await chatAgent.listTools();
  const vectorQuery = tools.vectorQuery;
  if (!isExecutable(vectorQuery)) {
    throw new Error('chatAgent has no executable vectorQuery tool');
  }

  const { sources } = toolOutputSchema.parse(
    await vectorQuery.execute(
      { queryText: 'anything at all', topK: MODEL_AUTHORED_TOPK },
      { requestContext },
    ),
  );

  return sorted(sources.map((source) => source.metadata.file_name));
}

describe('retrieval tool scope (integration)', () => {
  // One corpus for the whole file: two users, three Sources, four chunks. The
  // suffix keeps file names unique per run so a leftover row from another file
  // cannot be mistaken for one of these.
  const run = crypto.randomUUID().slice(0, 8);
  const ownerA = `user_a_${run}`;
  const ownerB = `user_b_${run}`;
  const names = {
    a1First: `a1-first-${run}.txt`,
    a1Second: `a1-second-${run}.txt`,
    a2Only: `a2-only-${run}.txt`,
    b1Only: `b1-only-${run}.txt`,
  };

  let a1 = '';
  let a2 = '';
  let b1 = '';

  beforeAll(async () => {
    const a1Source = await createDataSource({
      ownerId: ownerA,
      id: crypto.randomUUID(),
      name: `A1 ${run}`,
    });
    const a2Source = await createDataSource({
      ownerId: ownerA,
      id: crypto.randomUUID(),
      name: `A2 ${run}`,
    });
    const b1Source = await createDataSource({
      ownerId: ownerB,
      id: crypto.randomUUID(),
      name: `B1 ${run}`,
    });
    a1 = a1Source.id;
    a2 = a2Source.id;
    b1 = b1Source.id;

    await uploadDoc(txtFile(names.a1First), {
      ownerId: ownerA,
      dataSourceId: a1,
    });
    await uploadDoc(txtFile(names.a1Second), {
      ownerId: ownerA,
      dataSourceId: a1,
    });
    await uploadDoc(txtFile(names.a2Only), {
      ownerId: ownerA,
      dataSourceId: a2,
    });
    await uploadDoc(txtFile(names.b1Only), {
      ownerId: ownerB,
      dataSourceId: b1,
    });
  });

  // The corpus is read-only for every test below, so it is seeded once and
  // swept once — mutating it mid-file would make the set-equality assertions
  // depend on test order, which is the last thing a privacy claim should rest
  // on. Teardown is the production cascade, which deletes each Source's chunks
  // before its row.
  afterAll(async () => {
    await deleteDataSource({ ownerId: ownerA, id: a1 });
    await deleteDataSource({ ownerId: ownerA, id: a2 });
    await deleteDataSource({ ownerId: ownerB, id: b1 });
  });

  it("returns exactly the selected Source's chunks through the tool", async () => {
    // THE test. If the request-context filter did not reach the query, this
    // returns all four seeded chunks (the corpus is under `topK`), so the
    // full-corpus regression is caught by the equality rather than by luck.
    await expect(retrieveThroughTool(ownerA, [a1])).resolves.toEqual(
      sorted([names.a1First, names.a1Second]),
    );
  });

  it('returns exactly the union when two Sources are selected', async () => {
    await expect(retrieveThroughTool(ownerA, [a1, a2])).resolves.toEqual(
      sorted([names.a1First, names.a1Second, names.a2Only]),
    );
  });

  it("never reaches another user's chunks through the tool", async () => {
    const retrieved = await retrieveThroughTool(ownerA, [a1, a2]);

    // Stated as equality above; restated as explicit absence here because it is
    // the claim the feature exists to make.
    expect(retrieved).not.toContain(names.b1Only);
  });

  it("scopes B to B's own Source, over the same corpus", async () => {
    await expect(retrieveThroughTool(ownerB, [b1])).resolves.toEqual([
      names.b1Only,
    ]);
  });

  it('returns nothing at all for an empty scope', async () => {
    // `{ $in: [] }` reaches Postgres through the tool and matches nothing.
    // Retrieve-nothing is the ordinary empty set, not a missing filter — which
    // matters because the tool treats an empty-OBJECT filter as "enable
    // filtering, then drop the empty filter" and runs unfiltered on the fast
    // path. An empty `$in` must not collapse into that.
    await expect(retrieveThroughTool(ownerA, [])).resolves.toEqual([]);
  });
});
