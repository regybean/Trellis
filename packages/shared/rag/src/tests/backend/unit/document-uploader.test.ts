/**
 * Document uploader — domain (pure) tests.
 *
 * The named seams the uploader composes (`deriveChunkId`, `dedupeChunks`): fast,
 * no DB, no embeddings. The real `uploadDoc` behaviour against the vector
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
  it('collapses repeated chunk text within a file to one row', () => {
    const { ids, metadata } = dedupeChunks({
      file: txtFile('a.txt', ''),
      uploadTimestamp: 1,
      chunks: [{ text: 'same' }, { text: 'same' }, { text: 'different' }],
    });

    expect(ids).toHaveLength(2);
    expect(metadata).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('returns empty ids and metadata for a file with no chunks', () => {
    const { ids, metadata } = dedupeChunks({
      file: txtFile('a.txt', ''),
      uploadTimestamp: 1,
      chunks: [],
    });

    expect(ids).toEqual([]);
    expect(metadata).toEqual([]);
  });

  it('does not deduplicate the same text across different filenames', () => {
    const a = dedupeChunks({
      file: txtFile('a.txt', ''),
      uploadTimestamp: 1,
      chunks: [{ text: 'shared content' }],
    });
    const b = dedupeChunks({
      file: txtFile('b.txt', ''),
      uploadTimestamp: 2,
      chunks: [{ text: 'shared content' }],
    });

    // Same text, different file → different chunk id → no collision across files.
    expect(a.ids).toHaveLength(1);
    expect(b.ids).toHaveLength(1);
    expect(a.ids[0]).not.toBe(b.ids[0]);
    expect(a.metadata[0]?.file_name).toBe('a.txt');
    expect(b.metadata[0]?.file_name).toBe('b.txt');
  });
});
