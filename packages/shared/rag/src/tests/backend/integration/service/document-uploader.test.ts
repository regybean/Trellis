/**
 * Document uploader — service (integration) test.
 *
 * Cross-upload deduplication is a `vector_id` overwrite that only happens inside
 * Postgres, so this runs the real `uploadDoc` against the test vector database;
 * only the embed model is faked (see setup). The pure seams it composes
 * (`deriveChunkId`, `dedupeChunks`) are covered in `tests/backend/unit`.
 *
 * Every upload now needs a destination Data Source, and a real one: `uploadDoc`
 * re-asserts ownership immediately before the upsert, so an invented id gets
 * nothing written. Sources are seeded through `createDataSource` — never a raw
 * insert — because a fixture with more power than production can lie in both
 * directions.
 *
 * Retrieval exclusion is NOT asserted here. That claim needs its own fixture
 * shape and lives in `retrieval-scope.test.ts`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createDataSource, deleteDataSource } from '../../../../data-source';
import {
  countDocuments,
  deleteDocument,
  DocumentParseError,
  listDocuments,
  uploadDoc,
} from '../../../../document-uploader';
import { chunksIn, chunksOwnedBy } from '../../utils/chunks';
import { cleanupDataSources } from '../../utils/cleanup';

function txtFile(name: string, content: string) {
  return new File([content], name, { type: 'text/plain' });
}

function newSource(ownerId: string, name: string) {
  return createDataSource({ ownerId, id: crypto.randomUUID(), name });
}

const byName = (a: string, b: string) => a.localeCompare(b);

function uniqueFilename() {
  return `dedup-${crypto.randomUUID()}.txt`;
}

describe('uploadDoc (integration)', () => {
  const owners: string[] = [];

  function newOwner() {
    const ownerId = `user_${crypto.randomUUID()}`;
    owners.push(ownerId);
    return ownerId;
  }

  afterEach(async () => {
    await cleanupDataSources(owners.splice(0));
  });

  describe('parse failures', () => {
    it('throws when the file produces no parseable text', async () => {
      const ownerId = newOwner();
      const source = await newSource(ownerId, 'Parse failures');
      const name = uniqueFilename();

      await expect(
        uploadDoc(txtFile(name, ''), {
          ownerId,
          dataSourceId: source.id,
        }),
      ).rejects.toThrow(`No document could be parsed from file: ${name}`);
    });

    it('throws a tagged DocumentParseError carrying the filename', async () => {
      const ownerId = newOwner();
      const source = await newSource(ownerId, 'Tagged failure');
      const name = uniqueFilename();

      let caught: unknown;
      await uploadDoc(txtFile(name, ''), {
        ownerId,
        dataSourceId: source.id,
      }).catch((error: unknown) => {
        caught = error;
      });

      expect(caught).toBeInstanceOf(DocumentParseError);
      if (caught instanceof DocumentParseError) {
        expect(caught.fileName).toBe(name);
      }
    });
  });

  describe('stage reporting', () => {
    it('reports parsing then embedding for a real file', async () => {
      const ownerId = newOwner();
      const source = await newSource(ownerId, 'Stages');
      const stages: string[] = [];

      await uploadDoc(
        txtFile(uniqueFilename(), 'Content worth chunking and embedding.'),
        { ownerId, dataSourceId: source.id },
        {
          onStage: (stage) => {
            stages.push(stage);
          },
        },
      );

      // parsing precedes embedding, and uploadDoc emits only those two stages.
      expect(stages).toEqual(['parsing', 'embedding']);
    });

    it('emits no embedding stage when a file yields no parseable text', async () => {
      const ownerId = newOwner();
      const source = await newSource(ownerId, 'No text');
      const stages: string[] = [];

      await expect(
        uploadDoc(
          txtFile(uniqueFilename(), ''),
          { ownerId, dataSourceId: source.id },
          {
            onStage: (stage) => {
              stages.push(stage);
            },
          },
        ),
      ).rejects.toBeInstanceOf(DocumentParseError);

      // It reached parsing but threw before embedding.
      expect(stages).toEqual(['parsing']);
    });
  });

  describe('deduplication', () => {
    it('returns deletedCount 0 when the filename does not exist', async () => {
      const ownerId = newOwner();
      const source = await newSource(ownerId, 'Nothing here');
      const result = await deleteDocument({
        ownerId,
        dataSourceId: source.id,
        fileName: 'nonexistent-never-uploaded.txt',
      });
      expect(result).toEqual({
        deletedCount: 0,
        fileName: 'nonexistent-never-uploaded.txt',
      });
    });

    it('groups results by filename when multiple files are indexed', async () => {
      const ownerId = newOwner();
      const source = await newSource(ownerId, 'Two files');
      const nameA = uniqueFilename();
      const nameB = uniqueFilename();

      await uploadDoc(
        txtFile(nameA, 'First file has some content worth chunking.'),
        { ownerId, dataSourceId: source.id },
      );
      await uploadDoc(
        txtFile(nameB, 'Second file has different content worth chunking.'),
        { ownerId, dataSourceId: source.id },
      );

      const docs = await listDocuments({ ownerId });
      expect(docs.map((d) => d.filename).toSorted(byName)).toEqual(
        [nameA, nameB].toSorted(byName),
      );
      for (const doc of docs) {
        expect(doc.dataSourceId).toBe(source.id);
        expect(doc.count).toBeGreaterThan(0);
      }
      expect(await countDocuments({ ownerId, dataSourceId: source.id })).toBe(
        2,
      );
    });

    it('uploading the same file twice into the same Source does not duplicate its chunks', async () => {
      const ownerId = newOwner();
      const source = await newSource(ownerId, 'Re-upload');
      const name = uniqueFilename();
      const content =
        'The knowledge base stores chunks. Each chunk is embedded once.';

      await uploadDoc(txtFile(name, content), {
        ownerId,
        dataSourceId: source.id,
      });
      const afterFirst = await chunksIn(source.id);

      await uploadDoc(txtFile(name, content), {
        ownerId,
        dataSourceId: source.id,
      });
      const afterSecond = await chunksIn(source.id);

      expect(afterFirst.length).toBeGreaterThan(0);
      expect(afterSecond.map((chunk) => chunk.vectorId)).toEqual(
        afterFirst.map((chunk) => chunk.vectorId),
      );
    });

    it('gives the same file in two Sources two distinct chunk id sets', async () => {
      // Document identity is (owner_id, data_source_id, file_name), so this
      // embeds twice. That is the intended reading of "the same file in two
      // Sources is two Documents", and an honest doubling of cost — the
      // rejected alternative, one chunk set co-owned by several Sources, turns
      // delete into an array mutation over co-owned rows.
      const ownerId = newOwner();
      const first = await newSource(ownerId, 'First');
      const second = await newSource(ownerId, 'Second');
      const name = uniqueFilename();
      const content = 'One file, two destinations, two Documents.';

      await uploadDoc(txtFile(name, content), {
        ownerId,
        dataSourceId: first.id,
      });
      await uploadDoc(txtFile(name, content), {
        ownerId,
        dataSourceId: second.id,
      });

      const firstChunks = await chunksIn(first.id);
      const secondChunks = await chunksIn(second.id);
      const inFirst = firstChunks.map((chunk) => chunk.vectorId);
      const inSecond = secondChunks.map((chunk) => chunk.vectorId);

      expect(inFirst.length).toBeGreaterThan(0);
      expect(inSecond).toHaveLength(inFirst.length);
      expect(inFirst.filter((id) => inSecond.includes(id))).toEqual([]);
    });
  });

  describe('the destination, re-checked at upsert time', () => {
    it('throws for a Source deleted mid-flight, and writes nothing', async () => {
      // Not a race, and there is no interleaving to arrange: the assert runs at
      // use rather than at the edge, so delete, then call, then assert. The
      // negative matters more than the throw — a silent unstamped upsert would
      // cost money, appear nowhere and be deletable by nothing.
      const ownerId = newOwner();
      const source = await newSource(ownerId, 'Going away');
      await deleteDataSource({ ownerId, id: source.id });

      await expect(
        uploadDoc(txtFile(uniqueFilename(), 'Content worth chunking.'), {
          ownerId,
          dataSourceId: source.id,
        }),
      ).rejects.toThrow();

      expect(await chunksOwnedBy(ownerId)).toEqual([]);
    });

    it("throws for another owner's Source, and writes nothing", async () => {
      const ownerA = newOwner();
      const ownerB = newOwner();
      const bSource = await newSource(ownerB, 'Theirs');

      await expect(
        uploadDoc(txtFile(uniqueFilename(), 'Content worth chunking.'), {
          ownerId: ownerA,
          dataSourceId: bSource.id,
        }),
      ).rejects.toThrow();

      expect(await chunksOwnedBy(ownerA)).toEqual([]);
      expect(await chunksIn(bSource.id)).toEqual([]);
    });
  });
});
