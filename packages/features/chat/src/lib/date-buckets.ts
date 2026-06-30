// Date Buckets are derived (not stored): the server sends Conversations sorted
// by `updatedAt DESC` and the client labels each with a time/timezone-relative
// bucket. Keeping this on the client is deliberate — "Today" depends on the
// viewer's local midnight, which the server cannot know.

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
