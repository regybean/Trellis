/**
 * Document uploader — domain (pure) tests.
 *
 * The named seams the uploader composes (`deriveChunkId`, `dedupeChunks`): fast,
 * no DB, no embeddings. The real `uploadDocs` behaviour against the vector
 * database lives in `tests/service/document-uploader.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { dedupeChunks, deriveChunkId } from '../../../document-uploader';

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

  it('returns empty ids and metadata for an empty parsed array', () => {
    const { ids, metadata } = dedupeChunks([]);

    expect(ids).toEqual([]);
    expect(metadata).toEqual([]);
  });

  it('does not deduplicate the same text across different filenames', () => {
    const parsed = [
      {
        file: txtFile('a.txt', ''),
        uploadTimestamp: 1,
        chunks: [{ text: 'shared content' }],
      },
      {
        file: txtFile('b.txt', ''),
        uploadTimestamp: 2,
        chunks: [{ text: 'shared content' }],
      },
    ];

    const { ids, metadata } = dedupeChunks(parsed);

    // Same text, different file → different chunk id → two entries, not one.
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(metadata.map((m) => m.file_name)).toEqual(
      expect.arrayContaining(['a.txt', 'b.txt']),
    );
  });
});
