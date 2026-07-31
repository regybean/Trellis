import { describe, expect, it } from 'vitest';

import { redis } from '@acme/redis';

import type { NotificationEntry } from '../../../../api/services/notification-parser';
import { notificationKey } from '../../../../api/notification-keys';
import { tailNotifications } from '../../../../api/services/notification-reader';
import { publish } from '../../../../api/services/publish';

// Narrow a reader result to the yielded entry (or fail loudly if it closed).
function entryOf(result: IteratorResult<NotificationEntry, void>) {
  if (result.done) throw new Error('expected the reader to yield an entry');
  return result.value;
}

// `tailNotifications` against real Redis. Cursor assertions use explicit stream
// ids (an ancient `1-0`, and far-future `now + Nh` ids) rather than wall-clock
// timing, so they're deterministic regardless of any node↔Redis clock skew: a
// far-future id is always greater than the reader's `Date.now()-0` tail-from-now
// seed, and `1-0` is always less.
// Write a raw entry at an explicit id (the envelope publish would produce).
async function seedRaw(uid: string, id: string, message: string) {
  const payload = JSON.stringify({
    id: `env-${message}`,
    kind: 'test',
    level: 'info',
    message,
    createdAt: new Date().toISOString(),
  });
  await redis.xAdd(notificationKey(uid), id, { payload });
}

const hoursAhead = (n: number) => `${Date.now() + n * 3_600_000}-0`;

describe('tailNotifications', () => {
  const userId = 'user-reader';

  it('tails from now on a fresh connect — skips the pre-existing backlog', async () => {
    // A definitively-old entry that any tail-from-now seed excludes.
    await seedRaw(userId, '1-0', 'ancient');

    const controller = new AbortController();
    const gen = tailNotifications(userId, null, controller.signal);

    // Added after the reader is created; its id is far greater than the seed.
    await seedRaw(userId, hoursAhead(1), 'fresh');

    const first = await gen.next();
    controller.abort();

    expect(first.done).toBe(false);
    expect(entryOf(first).notification.message).toBe('fresh');
  });

  it('resumes exclusively after lastEventId (never re-reads a delivered entry)', async () => {
    await publish(userId, { kind: 'test', level: 'info', message: 'A' });
    await publish(userId, { kind: 'test', level: 'info', message: 'B' });

    const entries = await redis.xRange(notificationKey(userId), '-', '+');
    const [entryA] = entries;
    if (!entryA) throw new Error('expected seeded entries');
    const idA = entryA[0];

    const controller = new AbortController();
    const gen = tailNotifications(userId, idA, controller.signal);

    const next = await gen.next();
    controller.abort();

    // Exclusive `(idA` skips A and yields B — the round-trip through publish.
    expect(entryOf(next).notification.message).toBe('B');
  });

  it('never self-closes — yields across polls until aborted', async () => {
    const controller = new AbortController();
    const gen = tailNotifications(userId, null, controller.signal);

    await seedRaw(userId, hoursAhead(1), 'one');
    const r1 = await gen.next();
    expect(entryOf(r1).notification.message).toBe('one');

    // Still open: a later entry is delivered without restarting the reader.
    await seedRaw(userId, hoursAhead(2), 'two');
    const r2 = await gen.next();
    expect(entryOf(r2).notification.message).toBe('two');

    // Only an abort closes it.
    controller.abort();
    const r3 = await gen.next();
    expect(r3.done).toBe(true);
  });
});
