/**
 * The Data Source module — service (integration) test.
 *
 * Everything asserted here is a rule the module enforces against real Postgres:
 * the case-insensitive unique index, the per-owner cap, and the ownership
 * predicate `resolveRetrievalScope` calls before it builds anything. None of it
 * can be tested without the database, because in every case the database IS the
 * mechanism.
 *
 * What is NOT here: retrieval exclusion and the delete cascade's blast radius.
 * Both need stamped chunks, and stamping arrives with `uploadDoc`'s scope
 * argument in the next ticket. They land beside it, seeded through
 * `createDataSource` rather than a raw insert — a fixture with more power than
 * production can lie in both directions.
 *
 * Each test mints its own owner ids so nothing depends on suite ordering.
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
import { env } from '../../../../env';
import { cleanupDataSources } from '../../utils/cleanup';

// Seeding goes through the production create function, never a raw insert. A
// fixture with more power than production can lie in both directions: passing on
// a state that cannot occur, or failing on one that cannot either.
function source(ownerId: string, name: string) {
  return createDataSource({ ownerId, id: crypto.randomUUID(), name });
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

    it('deletes cleanly when the Source has no chunks', async () => {
      // The interrupted cross-database state: chunks gone, row surviving.
      // Retrying has to finish the job rather than error, which is the whole
      // reason chunks are deleted before the row.
      const ownerId = newOwner();
      const created = await source(ownerId, 'No chunks');

      await expect(
        deleteDataSource({ ownerId, id: created.id }),
      ).resolves.toMatchObject({ id: created.id, deletedChunkCount: 0 });
    });
  });
});
