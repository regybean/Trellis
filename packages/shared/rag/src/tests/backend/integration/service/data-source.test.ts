/**
 * The Data Source module — service (integration) test.
 *
 * Everything asserted here is a rule the module enforces against real Postgres:
 * the case-insensitive unique index, the per-owner cap, and the ownership
 * predicate `resolveRetrievalScope` calls before it builds anything. None of it
 * can be tested without the database, because in every case the database IS the
 * mechanism.
 *
 * The cascade's blast radius is here too, because a too-broad delete predicate
 * is the mirror image of a too-broad retrieval filter and worse: this one is
 * destructive and unrecoverable. The negative — that the siblings are untouched
 * — is the point of those tests, not the happy path.
 *
 * What is NOT here: retrieval exclusion. That claim needs a fixture shaped
 * around rag's identical-vector embed fake, and it lives in
 * `retrieval-scope.test.ts` with the reasoning written out.
 *
 * Each test mints its own owner ids so nothing depends on suite ordering, and
 * every Source is seeded through `createDataSource` rather than a raw insert —
 * a fixture with more power than production can lie in both directions.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertDataSourceOwned,
  createDataSource,
  DataSourceOwnershipError,
  DataSourceQuotaError,
  deleteDataSource,
  listDataSources,
  renameDataSource,
  resolveRetrievalScope,
} from '../../../../data-source';
import { deleteByFilename, uploadDoc } from '../../../../document-uploader';
import { env } from '../../../../env';
import { chunksIn } from '../../utils/chunks';
import { cleanupDataSources } from '../../utils/cleanup';

// Seeding goes through the production create function, never a raw insert. A
// fixture with more power than production can lie in both directions: passing on
// a state that cannot occur, or failing on one that cannot either.
function source(ownerId: string, name: string) {
  return createDataSource({ ownerId, id: crypto.randomUUID(), name });
}

// One short file per upload, so a Source's chunk count is just the number of
// files put in it — no dependence on how the chunker splits text.
async function upload(ownerId: string, dataSourceId: string) {
  const fileName = `cascade-${crypto.randomUUID()}.txt`;
  const file = new File([`Content of ${fileName} worth chunking.`], fileName, {
    type: 'text/plain',
  });
  await uploadDoc(file, { ownerId, dataSourceId });
  return fileName;
}

describe('data source module (integration)', () => {
  const owners: string[] = [];

  function newOwner() {
    const ownerId = `user_${crypto.randomUUID()}`;
    owners.push(ownerId);
    return ownerId;
  }

  afterEach(async () => {
    await cleanupDataSources(owners.splice(0));
  });

  describe('name rules', () => {
    it('rejects a second Source whose name differs only in case', async () => {
      const ownerId = newOwner();
      await source(ownerId, 'Work Notes');

      await expect(source(ownerId, 'work notes')).rejects.toThrow();
    });

    it('rejects a second Source whose name differs only in surrounding whitespace', async () => {
      const ownerId = newOwner();
      await source(ownerId, 'Work Notes');

      await expect(source(ownerId, '  Work Notes  ')).rejects.toThrow();
    });

    it('stores the case the user typed', async () => {
      const ownerId = newOwner();
      const created = await source(ownerId, 'Work Notes');

      expect(created.name).toBe('Work Notes');
    });

    it('trims the stored name, so trimming cannot be skipped by a caller', async () => {
      const ownerId = newOwner();
      const created = await source(ownerId, '  Work Notes  ');

      expect(created.name).toBe('Work Notes');
    });

    it('lets two different owners hold the same name', async () => {
      const ownerA = newOwner();
      const ownerB = newOwner();

      await source(ownerA, 'Work Notes');
      await expect(source(ownerB, 'Work Notes')).resolves.toMatchObject({
        name: 'Work Notes',
      });
    });

    it('frees the name for reuse after a hard delete', async () => {
      const ownerId = newOwner();
      const first = await source(ownerId, 'Work Notes');

      await deleteDataSource({ ownerId, id: first.id });

      await expect(source(ownerId, 'Work Notes')).resolves.toMatchObject({
        name: 'Work Notes',
      });
    });
  });

  describe('the per-owner cap', () => {
    it('throws at MAX_DATA_SOURCES_PER_USER, with no router having checked', async () => {
      const ownerId = newOwner();
      for (let i = 0; i < env.MAX_DATA_SOURCES_PER_USER; i++) {
        await source(ownerId, `Source ${i}`);
      }

      await expect(source(ownerId, 'One too many')).rejects.toBeInstanceOf(
        DataSourceQuotaError,
      );
    });

    it('counts per owner, so one owner at the cap does not block another', async () => {
      const ownerA = newOwner();
      const ownerB = newOwner();
      for (let i = 0; i < env.MAX_DATA_SOURCES_PER_USER; i++) {
        await source(ownerA, `Source ${i}`);
      }

      await expect(source(ownerB, 'First')).resolves.toMatchObject({
        name: 'First',
      });
    });
  });

  describe('ownership', () => {
    it('resolveRetrievalScope throws when the owner does not own the Source', async () => {
      const ownerA = newOwner();
      const ownerB = newOwner();
      const bSource = await source(ownerB, "B's notes");

      await expect(
        resolveRetrievalScope({
          ownerId: ownerA,
          dataSourceIds: [bSource.id],
        }),
      ).rejects.toBeInstanceOf(DataSourceOwnershipError);
    });

    it('throws for a mixed selection rather than silently keeping the owned half', async () => {
      const ownerA = newOwner();
      const ownerB = newOwner();
      const aSource = await source(ownerA, "A's notes");
      const bSource = await source(ownerB, "B's notes");

      await expect(
        resolveRetrievalScope({
          ownerId: ownerA,
          dataSourceIds: [aSource.id, bSource.id],
        }),
      ).rejects.toBeInstanceOf(DataSourceOwnershipError);
    });

    it("names only the ids that were not the caller's", async () => {
      const ownerA = newOwner();
      const ownerB = newOwner();
      const aSource = await source(ownerA, "A's notes");
      const bSource = await source(ownerB, "B's notes");

      let caught: unknown;
      await assertDataSourceOwned({
        ownerId: ownerA,
        dataSourceIds: [aSource.id, bSource.id],
      }).catch((error: unknown) => {
        caught = error;
      });

      expect(caught).toBeInstanceOf(DataSourceOwnershipError);
      if (caught instanceof DataSourceOwnershipError) {
        expect(caught.dataSourceIds).toEqual([bSource.id]);
      }
    });

    it('throws for a Source deleted since the selection was made', async () => {
      // The delete-while-in-flight case. There is no interleaving to arrange,
      // because the assert runs at use rather than at the edge: delete, then
      // call, then assert.
      const ownerId = newOwner();
      const deleted = await source(ownerId, 'Going away');
      await deleteDataSource({ ownerId, id: deleted.id });

      await expect(
        resolveRetrievalScope({ ownerId, dataSourceIds: [deleted.id] }),
      ).rejects.toBeInstanceOf(DataSourceOwnershipError);
    });

    it('treats an unknown id as unowned', async () => {
      const ownerId = newOwner();

      await expect(
        resolveRetrievalScope({
          ownerId,
          dataSourceIds: [crypto.randomUUID()],
        }),
      ).rejects.toBeInstanceOf(DataSourceOwnershipError);
    });
  });

  describe('the resolved retrieval scope', () => {
    it('reports hasSources false and an empty $in for an empty selection', async () => {
      const ownerId = newOwner();

      const { requestContext, hasSources } = await resolveRetrievalScope({
        ownerId,
        dataSourceIds: [],
      });

      expect(hasSources).toBe(false);
      // Built unbranched: "retrieve nothing" is the ordinary empty set, not a
      // missing filter. If the caller's activeTools optimisation is ever
      // dropped, this is what still fails closed.
      expect(requestContext.get('filter')).toEqual({
        owner_id: ownerId,
        data_source_id: { $in: [] },
      });
    });

    it('carries the verified owner and the selected ids, plus the server-pinned topK', async () => {
      const ownerId = newOwner();
      const first = await source(ownerId, 'First');
      const second = await source(ownerId, 'Second');

      const { requestContext, hasSources } = await resolveRetrievalScope({
        ownerId,
        dataSourceIds: [first.id, second.id],
      });

      expect(hasSources).toBe(true);
      expect(requestContext.get('filter')).toEqual({
        owner_id: ownerId,
        data_source_id: { $in: [first.id, second.id] },
      });
      expect(requestContext.get('topK')).toBe(env.RETRIEVAL_TOP_K);
    });
  });

  describe('list, rename and delete', () => {
    it("lists only the caller's own Sources", async () => {
      const ownerA = newOwner();
      const ownerB = newOwner();
      const aSource = await source(ownerA, "A's notes");
      await source(ownerB, "B's notes");

      const listed = await listDataSources({ ownerId: ownerA });

      expect(listed.map((row) => row.id)).toEqual([aSource.id]);
    });

    it('renames a Source the caller owns', async () => {
      const ownerId = newOwner();
      const created = await source(ownerId, 'Before');

      const renamed = await renameDataSource({
        ownerId,
        id: created.id,
        name: 'After',
      });

      expect(renamed.name).toBe('After');
      expect(renamed.id).toBe(created.id);
    });

    it("refuses to rename another owner's Source", async () => {
      const ownerA = newOwner();
      const ownerB = newOwner();
      const bSource = await source(ownerB, 'Theirs');

      await expect(
        renameDataSource({ ownerId: ownerA, id: bSource.id, name: 'Mine now' }),
      ).rejects.toBeInstanceOf(DataSourceOwnershipError);

      const stillTheirs = await listDataSources({ ownerId: ownerB });
      expect(stillTheirs.map((row) => row.name)).toEqual(['Theirs']);
    });

    it("refuses to delete another owner's Source", async () => {
      const ownerA = newOwner();
      const ownerB = newOwner();
      const bSource = await source(ownerB, 'Theirs');

      await expect(
        deleteDataSource({ ownerId: ownerA, id: bSource.id }),
      ).rejects.toBeInstanceOf(DataSourceOwnershipError);

      const stillTheirs = await listDataSources({ ownerId: ownerB });
      expect(stillTheirs.map((row) => row.id)).toEqual([bSource.id]);
    });

    it('removes the row and leaves siblings alone', async () => {
      const ownerId = newOwner();
      const doomed = await source(ownerId, 'Doomed');
      const keeper = await source(ownerId, 'Keeper');

      await deleteDataSource({ ownerId, id: doomed.id });

      const remaining = await listDataSources({ ownerId });
      expect(remaining.map((row) => row.id)).toEqual([keeper.id]);
    });

    it('deletes cleanly when the Source never held a chunk', async () => {
      // Nothing has uploaded in this process, so `mastra_documents` may not
      // exist yet. A delete must not depend on Mastra having lazily created it
      // — the row would survive and the user would see the delete bounce.
      const ownerId = newOwner();
      const created = await source(ownerId, 'No chunks');

      await expect(
        deleteDataSource({ ownerId, id: created.id }),
      ).resolves.toMatchObject({ id: created.id, deletedChunkCount: 0 });
    });
  });

  describe('the cascade', () => {
    it("deletes the Source's chunks and leaves every sibling's alone", async () => {
      // The blast radius. The chunk delete filters on the same metadata shape
      // retrieval does, so getting it too broad destroys another Source's — or
      // another user's — documents, unrecoverably.
      const ownerA = newOwner();
      const ownerB = newOwner();
      const a1 = await source(ownerA, 'A1');
      const a2 = await source(ownerA, 'A2');
      const b1 = await source(ownerB, 'B1');

      await upload(ownerA, a1.id);
      await upload(ownerA, a1.id);
      await upload(ownerA, a2.id);
      await upload(ownerB, b1.id);

      const a2Before = await chunksIn(a2.id);
      const b1Before = await chunksIn(b1.id);
      expect(await chunksIn(a1.id)).toHaveLength(2);
      expect(a2Before).toHaveLength(1);
      expect(b1Before).toHaveLength(1);

      const result = await deleteDataSource({ ownerId: ownerA, id: a1.id });

      expect(result.deletedChunkCount).toBe(2);
      expect(await chunksIn(a1.id)).toEqual([]);
      expect(await chunksIn(a2.id)).toEqual(a2Before);
      expect(await chunksIn(b1.id)).toEqual(b1Before);
    });

    it('finishes an interrupted delete rather than erroring on it', async () => {
      // The one interrupted cross-database state this ordering can produce:
      // chunks gone, row surviving. Hitting delete again has to finish the job,
      // which is the whole reason chunks go before the row. Reached here by
      // deleting the chunks through their own production path, not by injecting
      // a failure into a module we own.
      const ownerId = newOwner();
      const created = await source(ownerId, 'Half deleted');
      const fileName = await upload(ownerId, created.id);

      await deleteByFilename(fileName);
      expect(await chunksIn(created.id)).toEqual([]);

      await expect(
        deleteDataSource({ ownerId, id: created.id }),
      ).resolves.toMatchObject({ id: created.id, deletedChunkCount: 0 });

      const remaining = await listDataSources({ ownerId });
      expect(remaining).toEqual([]);
    });
  });
});
