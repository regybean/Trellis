/**
 * Document uploader tests.
 *
 * Two layers:
 * - Pure unit tests for the named seams the uploader composes (`deriveChunkId`,
 *   `dedupeChunks`) — fast, no DB, no embeddings.
 * - One integration test for cross-upload deduplication, which is a `vector_id`
 *   overwrite that only happens inside Postgres. It runs the real `uploadDocs`
 *   against the test vector database; only the embed model is faked (see setup).
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  dedupeChunks,
  deleteByFilename,
  deriveChunkId,
  listDocuments,
  uploadDocs,
} from '../../document-uploader';

function txtFile(name: string, content: string) {
  return new File([content], name, { type: 'text/plain' });
}

describe('deriveChunkId', () => {
  it('is stable for the same content and filename', () => {
    expect(deriveChunkId('hello world', 'a.txt')).toBe(
      deriveChunkId('hello world', 'a.txt'),
    );
  });

  it('ignores surrounding whitespace in the content', () => {
    expect(deriveChunkId('  hello world  ', 'a.txt')).toBe(
      deriveChunkId('hello world', 'a.txt'),
    );
  });

  it('differs when the content differs', () => {
    expect(deriveChunkId('hello', 'a.txt')).not.toBe(
      deriveChunkId('world', 'a.txt'),
    );
  });

  it('differs when the filename differs', () => {
    expect(deriveChunkId('hello', 'a.txt')).not.toBe(
      deriveChunkId('hello', 'b.txt'),
    );
  });
});

describe('dedupeChunks', () => {
  it('collapses repeated chunk text within a batch to one row', () => {
    const parsed = [
      {
        file: txtFile('a.txt', ''),
        uploadTimestamp: 1,
        chunks: [{ text: 'same' }, { text: 'same' }, { text: 'different' }],
      },
    ];

    const { ids, metadata } = dedupeChunks(parsed);

    expect(ids).toHaveLength(2);
    expect(metadata).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

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
