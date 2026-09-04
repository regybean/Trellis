// Date Buckets are derived (not stored): the server sends Conversations sorted
// by `updatedAt DESC` and the client labels each with a time/timezone-relative
// bucket. Keeping this on the client is deliberate — "Today" depends on the
// viewer's local midnight, which the server cannot know.

import type { SelectConversationSummary } from '../api/schemas/chat-schema';

export type DateBucket = 'today' | 'week' | 'older';

// Render order, Folders excluded (those come first and are user-defined).
export const DATE_BUCKET_ORDER: readonly DateBucket[] = [
  'today',
  'week',
  'older',
];

export const DATE_BUCKET_LABELS: Record<DateBucket, string> = {
  today: 'Today',
  week: 'This week',
  older: 'Older',
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Today = since local midnight; This week = the preceding 7 days; Older =
// everything before. `now` is injected so the function stays pure and testable.
export function bucketOf(updatedAt: Date, now: Date): DateBucket {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  if (updatedAt.getTime() >= midnight.getTime()) return 'today';
  if (updatedAt.getTime() >= now.getTime() - WEEK_MS) return 'week';
  return 'older';
}

export interface GroupedConversations {
  // Folder id → its Conversations. Only ids that still resolve to a known
  // Folder get an entry; a dangling id never appears here.
  byFolder: Map<string, SelectConversationSummary[]>;
  // The un-foldered remainder, labelled by Date Bucket.
  buckets: Record<DateBucket, SelectConversationSummary[]>;
}

// Split the flat Conversation list into Folder groups first, then Date Buckets
// for whatever is left. A Conversation belongs to a Folder only if its
// `folderId` still resolves to a known Folder in `folderIds`; a dangling id (a
// deleted Folder) falls through to the buckets — the lazy-deletion fallback
// (see @acme/chat ADR 0005), with no per-Conversation write.
// `conversations` is assumed to arrive sorted
// `updatedAt DESC` (the server sorts), so per-group and per-bucket order is
// simply preserved. `now` is injected so the function stays pure and testable.
export function groupConversations(
  conversations: readonly SelectConversationSummary[],
  folderIds: ReadonlySet<string>,
  now: Date,
): GroupedConversations {
  const byFolder = new Map<string, SelectConversationSummary[]>();
  const buckets: Record<DateBucket, SelectConversationSummary[]> = {
    today: [],
    week: [],
    older: [],
  };

  for (const c of conversations) {
    if (c.folderId !== null && folderIds.has(c.folderId)) {
      const list = byFolder.get(c.folderId) ?? [];
      list.push(c);
      byFolder.set(c.folderId, list);
    } else {
      buckets[bucketOf(c.updatedAt, now)].push(c);
    }
  }

  return { byFolder, buckets };
}
