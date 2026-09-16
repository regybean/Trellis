/**
 * The privacy boundary, proven against real pgvector.
 *
 * This is the load-bearing test of the whole partition, and it sits here rather
 * than at a tRPC procedure because `chatAgent.stream` is stubbed in every chat
 * backend test — so `chat.send` can prove *rejection* and never *exclusion*.
 * The LLM is a legitimately mocked external sitting between the procedure and
 * the filter, which puts the strongest test of the boundary below any router,
 * in the package that has no router at all. That is where the mock boundary
 * honestly falls, not a gap to close later.
 *
 * The fixture shape is load-bearing, and the reason is a trap worth spelling
 * out. rag's embed fake returns an IDENTICAL vector for every value, so every
 * chunk sits at the same distance from every query and the `ORDER BY … LIMIT
 * topK` cut among perfect ties is arbitrary. The obvious formulation — "assert
 * B's chunks are absent" — can therefore pass because `topK` truncated them
 * rather than because the filter excluded them, and on a large enough corpus it
 * is green with the filter removed entirely. So:
 *
 *   - Two users, three Sources, a KNOWN chunk count each, four chunks total,
 *     comfortably under `topK`, so nothing can be lost to truncation.
 *   - Assertions are positive and exhaustive — full set equality, never "does
 *     not contain B". The negative-only form is what lets the truncation
 *     false-pass through.
 *   - The identical-vector fake stays. Varying embeddings would buy relevance
 *     realism this test does not want, at the price of non-determinism in the
 *     one dimension a privacy claim must not depend on.
 *
 * Each file yields exactly one chunk (short text, `CHUNK_SIZE` 1024), so chunk
 * counts are controlled by the number of files rather than by text length,
 * which would be fragile.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDataSource,
  resolveRetrievalScope,
} from '../../../../data-source';
import { uploadDoc } from '../../../../document-uploader';
import { EMBED_DIMENSIONS } from '../../../../schemas/documents-schema';
import { indexName, pgVector } from '../../../../vector';
import { cleanupDataSources } from '../../utils/cleanup';

// Matches the embed fake in `setup.ts`: one fixed, dimension-correct vector, so
// every stored chunk is equidistant from this query and only the filter can
// decide what comes back.
const queryVector = Array.from({ length: EMBED_DIMENSIONS }, () => 0.1);

function txtFile(name: string) {
  return new File([`Content of ${name} worth chunking.`], name, {
    type: 'text/plain',
  });
}

function newSource(ownerId: string, name: string) {
  return createDataSource({ ownerId, id: crypto.randomUUID(), name });
}

/**
 * Retrieve through the production path: `resolveRetrievalScope` builds the
 * trusted `RequestContext`, and the filter and `topK` come straight back out of
 * it. Nothing here hand-builds a filter — the point is that the object the
 * agent would have been handed is the object that reaches Postgres.
 */
async function retrieve(ownerId: string, dataSourceIds: string[]) {
  const { requestContext } = await resolveRetrievalScope({
    ownerId,
    dataSourceIds,
  });

  const results = await pgVector.query({
    indexName,
    queryVector,
    topK: requestContext.get('topK'),
    filter: requestContext.get('filter'),
  });

  return results
    .map((result) => String(result.metadata?.file_name))
    .toSorted((a, b) => a.localeCompare(b));
}

// Retrieval order among perfect ties is arbitrary, so both sides of every set
// comparison are sorted the same way.
const sorted = (fileNames: string[]) =>
  fileNames.toSorted((a, b) => a.localeCompare(b));

describe('retrieval scope (integration)', () => {
  const owners: string[] = [];

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
    owners.push(ownerA, ownerB);

    // Seeded through the production create function, never a raw insert.
    const a1Source = await newSource(ownerA, `A1 ${run}`);
    const a2Source = await newSource(ownerA, `A2 ${run}`);
    const b1Source = await newSource(ownerB, `B1 ${run}`);
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

  // The corpus is read-only for every test below — nothing here creates,
  // deletes or re-uploads — so it is seeded once and swept once. Mutating it
  // mid-file would make the set-equality assertions depend on test order, which
  // is the last thing a privacy claim should rest on. The cascade's effect on
  // it is asserted in `data-source.test.ts`, on its own fixture.
  afterAll(async () => {
    await cleanupDataSources(owners.splice(0));
  });

  it('returns exactly the chunks of the one selected Source', async () => {
    await expect(retrieve(ownerA, [a1])).resolves.toEqual(
      sorted([names.a1First, names.a1Second]),
    );
  });

  it('returns exactly the union when two Sources are selected', async () => {
    await expect(retrieve(ownerA, [a1, a2])).resolves.toEqual(
      sorted([names.a1First, names.a1Second, names.a2Only]),
    );
  });

  it("never reaches another user's chunks, even for the whole of A's selection", async () => {
    const retrieved = await retrieve(ownerA, [a1, a2]);

    // Stated as equality above; restated as the explicit absence here because
    // it is the claim the feature exists to make.
    expect(retrieved).not.toContain(names.b1Only);
  });

  it("scopes B to B's own Source, over the same corpus", async () => {
    await expect(retrieve(ownerB, [b1])).resolves.toEqual([names.b1Only]);
  });

  it('returns nothing at all for an empty scope', async () => {
    // `{ $in: [] }` is built unbranched and reaches Postgres here. Retrieve
    // nothing is the ordinary empty set, not a missing filter — which matters
    // because Mastra treats an empty-OBJECT filter as "enable filtering, then
    // drop the empty filter" and runs unfiltered.
    await expect(retrieve(ownerA, [])).resolves.toEqual([]);
  });

  it("rejects B's Source id presented by A, before any query runs", async () => {
    // The assert is inside `resolveRetrievalScope`, so there is no filter to
    // get wrong: the call never reaches Postgres.
    await expect(retrieve(ownerA, [b1])).rejects.toThrow();
    await expect(retrieve(ownerA, [a1, b1])).rejects.toThrow();
  });
});
