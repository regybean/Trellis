/**
 * Document uploader — domain (pure) tests.
 *
 * The named seams the uploader composes (`deriveChunkId`, `dedupeChunks`): fast,
 * no DB, no embeddings. The real `uploadDoc` behaviour against the vector
 * database lives in `tests/service/document-uploader.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { UploadScope } from '../../../document-uploader';
import { dedupeChunks, deriveChunkId } from '../../../document-uploader';

function txtFile(name: string, content: string) {
  return new File([content], name, { type: 'text/plain' });
}

const A1: UploadScope = {
  ownerId: 'user_a',
  dataSourceId: '11111111-1111-4111-8111-111111111111',
};
const A2: UploadScope = {
  ownerId: 'user_a',
  dataSourceId: '22222222-2222-4222-8222-222222222222',
};
const B1: UploadScope = {
  ownerId: 'user_b',
  dataSourceId: '11111111-1111-4111-8111-111111111111',
};

describe('deriveChunkId', () => {
  it('is stable for the same content, filename and scope', () => {
    expect(deriveChunkId('hello world', 'a.txt', A1)).toBe(
      deriveChunkId('hello world', 'a.txt', A1),
    );
  });

  it('ignores surrounding whitespace in the content', () => {
    expect(deriveChunkId('  hello world  ', 'a.txt', A1)).toBe(
      deriveChunkId('hello world', 'a.txt', A1),
    );
  });

  it('differs when the content differs', () => {
    expect(deriveChunkId('hello', 'a.txt', A1)).not.toBe(
      deriveChunkId('world', 'a.txt', A1),
    );
  });

  it('differs when the filename differs', () => {
    expect(deriveChunkId('hello', 'a.txt', A1)).not.toBe(
      deriveChunkId('hello', 'b.txt', A1),
    );
  });

  it('differs when the destination Source differs', () => {
    // The same file in two Sources is two Documents, so it derives two ids and
    // embeds twice. An honest doubling of cost for a duplicated file — and the
    // alternative (one co-owned chunk set) turns delete into an array mutation
    // over rows several Sources share.
    expect(deriveChunkId('hello', 'a.txt', A1)).not.toBe(
      deriveChunkId('hello', 'a.txt', A2),
    );
  });

  it('differs when the owner differs, even for the same Source id', () => {
    // Source ids are client-minted, so two owners presenting the same id must
    // not collide onto one chunk set.
    expect(deriveChunkId('hello', 'a.txt', A1)).not.toBe(
      deriveChunkId('hello', 'a.txt', B1),
    );
  });
});

describe('dedupeChunks', () => {
  it('collapses repeated chunk text within a file to one row', () => {
    const { ids, metadata } = dedupeChunks({
      file: txtFile('a.txt', ''),
      uploadTimestamp: 1,
      chunks: [{ text: 'same' }, { text: 'same' }, { text: 'different' }],
      scope: A1,
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
      scope: A1,
    });

    expect(ids).toEqual([]);
    expect(metadata).toEqual([]);
  });

  it('does not deduplicate the same text across different filenames', () => {
    const a = dedupeChunks({
      file: txtFile('a.txt', ''),
      uploadTimestamp: 1,
      chunks: [{ text: 'shared content' }],
      scope: A1,
    });
    const b = dedupeChunks({
      file: txtFile('b.txt', ''),
      uploadTimestamp: 2,
      chunks: [{ text: 'shared content' }],
      scope: A1,
    });

    // Same text, different file → different chunk id → no collision across files.
    expect(a.ids).toHaveLength(1);
    expect(b.ids).toHaveLength(1);
    expect(a.ids[0]).not.toBe(b.ids[0]);
    expect(a.metadata[0]?.file_name).toBe('a.txt');
    expect(b.metadata[0]?.file_name).toBe('b.txt');
  });

  it('stamps every chunk with its owner and Data Source', () => {
    // The stamp is what the retrieval filter reads back, so an unstamped chunk
    // would be retrievable by nobody. There is no code path that produces one:
    // the scope is required to get this far.
    const { metadata } = dedupeChunks({
      file: txtFile('a.txt', ''),
      uploadTimestamp: 1,
      chunks: [{ text: 'first' }, { text: 'second' }],
      scope: A1,
    });

    expect(metadata).toHaveLength(2);
    for (const row of metadata) {
      expect(row.owner_id).toBe(A1.ownerId);
      expect(row.data_source_id).toBe(A1.dataSourceId);
    }
  });

  it('gives the same file in two Sources two distinct id sets', () => {
    const intoA1 = dedupeChunks({
      file: txtFile('shared.txt', ''),
      uploadTimestamp: 1,
      chunks: [{ text: 'one' }, { text: 'two' }],
      scope: A1,
    });
    const intoA2 = dedupeChunks({
      file: txtFile('shared.txt', ''),
      uploadTimestamp: 1,
      chunks: [{ text: 'one' }, { text: 'two' }],
      scope: A2,
    });

    expect(intoA1.ids).toHaveLength(2);
    expect(intoA2.ids).toHaveLength(2);
    expect(intoA1.ids.filter((id) => intoA2.ids.includes(id))).toEqual([]);
  });
});
