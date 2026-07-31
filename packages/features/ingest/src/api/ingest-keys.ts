import { nsKey } from '@acme/redis';

// Redis key builders for the ingest async pipeline. All keys go through nsKey so
// the app namespace prefix is applied consistently.

// The per-USER live-progress Redis Stream. Unlike chat's per-route stream, one
// stream carries the per-file stage transitions for ALL of a user's Jobs — it is
// long-lived (tail-from-now, no per-Job terminal) and page-scoped on read. The
// writer stamps a rolling TTL on every append so an abandoned stream self-expires;
// nothing ever deletes it.
export const ingestProgressKey = (userId: string) =>
  nsKey('ingest', 'progress', userId);
