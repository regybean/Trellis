/**
 * Document uploader — service (integration) test.
 *
 * Cross-upload deduplication is a `vector_id` overwrite that only happens inside
 * Postgres, so this runs the real `uploadDocs` against the test vector database;
 * only the embed model is faked (see setup). The pure seams it composes
 * (`deriveChunkId`, `dedupeChunks`) are covered in `tests/domain`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  deleteByFilename,
  listDocuments,
  uploadDocs,
} from '../../../../document-uploader';

function txtFile(name: string, content: string) {
  return new File([content], name, { type: 'text/plain' });
}

describe('uploadDocs deduplication (integration)', () => {
  const created: string[] = [];

  function uniqueFilename() {
    const name = `dedup-${crypto.randomUUID()}.txt`;
    created.push(name);
    return name;
  }

  afterEach(async () => {
    for (const name of created.splice(0)) {
      await deleteByFilename(name);
    }
  });

  it('throws when the file produces no parseable text', async () => {
    const name = uniqueFilename();
    await expect(uploadDocs([txtFile(name, '')])).rejects.toThrow(
      `No document could be parsed from file: ${name}`,
    );
  });

  it('returns deletedCount 0 when filename does not exist', async () => {
    const result = await deleteByFilename('nonexistent-never-uploaded.txt');
    expect(result).toEqual({
      deletedCount: 0,
      filename: 'nonexistent-never-uploaded.txt',
    });
  });

  it('groups results by filename when multiple files are indexed', async () => {
    const nameA = uniqueFilename();
    const nameB = uniqueFilename();

    await uploadDocs([
      txtFile(nameA, 'First file has some content worth chunking.'),
      txtFile(nameB, 'Second file has different content worth chunking.'),
    ]);

    const docs = await listDocuments();
    const docA = docs.find((d) => d.filename === nameA);
    const docB = docs.find((d) => d.filename === nameB);

    expect(docA?.count).toBeGreaterThan(0);
    expect(docB?.count).toBeGreaterThan(0);
  });

  it('uploading the same file twice does not duplicate its chunks', async () => {
    const name = uniqueFilename();
    const content =
      'The knowledge base stores chunks. Each chunk is embedded once.';

    await uploadDocs([txtFile(name, content)]);
    const firstList = await listDocuments();
    const afterFirst = firstList.find((d) => d.filename === name);

    await uploadDocs([txtFile(name, content)]);
    const secondList = await listDocuments();
    const afterSecond = secondList.find((d) => d.filename === name);

    expect(afterFirst?.count).toBeGreaterThan(0);
    expect(afterSecond?.count).toBe(afterFirst?.count);
  });
});
