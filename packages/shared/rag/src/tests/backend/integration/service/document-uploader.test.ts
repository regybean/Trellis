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

  it('uploading the same file twice does not duplicate its chunks', async () => {
    const name = uniqueFilename();
    const content =
      'The knowledge base stores chunks. Each chunk is embedded once.';

    await uploadDocs([txtFile(name, content)]);
    const afterFirst = (await listDocuments()).find((d) => d.filename === name);

    await uploadDocs([txtFile(name, content)]);
    const afterSecond = (await listDocuments()).find(
      (d) => d.filename === name,
    );

    expect(afterFirst?.count).toBeGreaterThan(0);
    expect(afterSecond?.count).toBe(afterFirst?.count);
  });
});
