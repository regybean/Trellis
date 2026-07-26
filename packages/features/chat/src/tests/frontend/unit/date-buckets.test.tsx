import { describe, expect, it } from 'vitest';

import type { SelectConversationSummary } from '../../../api/schemas/chat-schema';
import { bucketOf, groupConversations } from '../../../lib/date-buckets';

// `now` is fixed mid-afternoon so "today" clearly starts at an earlier local
// midnight and the 7-day window is unambiguous.
const NOW = new Date('2026-06-30T15:00:00');

describe('bucketOf', () => {
  it('buckets activity since local midnight as today', () => {
    expect(bucketOf(new Date('2026-06-30T00:00:00'), NOW)).toBe('today');
    expect(bucketOf(new Date('2026-06-30T14:59:59'), NOW)).toBe('today');
  });

  it('buckets the prior 7 days as week', () => {
    expect(bucketOf(new Date('2026-06-29T23:59:59'), NOW)).toBe('week');
    expect(bucketOf(new Date('2026-06-24T15:00:01'), NOW)).toBe('week');
  });

  it('buckets anything older than 7 days as older', () => {
    expect(bucketOf(new Date('2026-06-23T14:59:59'), NOW)).toBe('older');
    expect(bucketOf(new Date('2025-01-01T00:00:00'), NOW)).toBe('older');
  });
});

function makeConversation(
  overrides: Partial<SelectConversationSummary> = {},
): SelectConversationSummary {
  return {
    sessionId: '00000000-0000-0000-0000-000000000000',
    title: 'A chat',
    updatedAt: new Date('2026-06-30T12:00:00'),
    folderId: null,
    ...overrides,
  };
}

describe('groupConversations', () => {
  it('files Conversations under their resolving Folder id', () => {
    const a = makeConversation({ sessionId: 'a', folderId: 'f1' });
    const b = makeConversation({ sessionId: 'b', folderId: 'f1' });
    const c = makeConversation({ sessionId: 'c', folderId: 'f2' });

    const { byFolder } = groupConversations(
      [a, b, c],
      new Set(['f1', 'f2']),
      NOW,
    );

    expect(byFolder.get('f1')).toEqual([a, b]);
    expect(byFolder.get('f2')).toEqual([c]);
  });

  it('falls a dangling Folder id back to its Date Bucket', () => {
    // A deleted Folder leaves member threads with a folderId that no longer
    // resolves. Rather than a per-Conversation write, the client returns them
    // to their Date Bucket by simply failing to resolve the id.
    const dangling = makeConversation({
      sessionId: 'x',
      folderId: 'deleted-folder',
      updatedAt: new Date('2026-06-30T09:00:00'),
    });

    const { byFolder, buckets } = groupConversations(
      [dangling],
      new Set(['f1']),
      NOW,
    );

    expect(byFolder.size).toBe(0);
    expect(buckets.today).toEqual([dangling]);
  });

  it('groups un-foldered Conversations by Date Bucket, preserving DESC order', () => {
    // Input arrives sorted updatedAt DESC (the server sorts); grouping must
    // preserve that order within each bucket.
    const todayA = makeConversation({
      sessionId: 't1',
      updatedAt: new Date('2026-06-30T14:00:00'),
    });
    const todayB = makeConversation({
      sessionId: 't2',
      updatedAt: new Date('2026-06-30T08:00:00'),
    });
    const week = makeConversation({
      sessionId: 'w1',
      updatedAt: new Date('2026-06-28T08:00:00'),
    });
    const older = makeConversation({
      sessionId: 'o1',
      updatedAt: new Date('2026-01-01T08:00:00'),
    });

    const { buckets } = groupConversations(
      [todayA, todayB, week, older],
      new Set(),
      NOW,
    );

    expect(buckets.today).toEqual([todayA, todayB]);
    expect(buckets.week).toEqual([week]);
    expect(buckets.older).toEqual([older]);
  });
});
