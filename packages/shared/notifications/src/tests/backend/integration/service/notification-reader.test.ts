import { describe, expect, it, vi } from 'vitest';

import { redis } from '@acme/redis';

import type { NotificationEntry } from '../../../../api/services/notification-stream';
import { notificationKey } from '../../../../api/notification-keys';
import { tailNotifications } from '../../../../api/services/notification-stream';
import { publish } from '../../../../api/services/publish';

// Narrow a reader result to the yielded entry (or fail loudly if it closed).
function entryOf(result: IteratorResult<NotificationEntry, void>) {
  if (result.done) throw new Error('expected the reader to yield an entry');
  return result.value;
}

// `tailNotifications` against real Redis. The fresh-connect seed is now the
// stream's ACTUAL last id (`lastId()` via XREVRANGE), captured EAGERLY at attach,
// so `tailNotifications` is awaited before the reader is driven — the boundary is
// pinned when the reader attaches, not when it is first pulled.

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
    // A definitively-old entry the fresh-connect seed (the stream's last id at
    // attach) excludes.
    await seedRaw(userId, '1-0', 'ancient');

    const controller = new AbortController();
    // Awaited: the seed (lastId = '1-0') is captured HERE, before 'fresh' exists.
    const gen = await tailNotifications(userId, null, controller.signal);

    // Added after attach; its id is far greater than the seed.
    await seedRaw(userId, hoursAhead(1), 'fresh');

    const first = await gen.next();
    controller.abort();

    expect(first.done).toBe(false);
    expect(entryOf(first).event.message).toBe('fresh');
  });

  it('resumes exclusively after lastEventId (never re-reads a delivered entry)', async () => {
    await publish(userId, { kind: 'test', level: 'info', message: 'A' });
    await publish(userId, { kind: 'test', level: 'info', message: 'B' });

    const entries = await redis.xRange(notificationKey(userId), '-', '+');
    const [entryA] = entries;
    if (!entryA) throw new Error('expected seeded entries');
    const idA = entryA[0];

    const controller = new AbortController();
    const gen = await tailNotifications(userId, idA, controller.signal);

    const next = await gen.next();
    controller.abort();

    // Exclusive `(idA` skips A and yields B — the round-trip through publish.
    expect(entryOf(next).event.message).toBe('B');
  });

  it('never self-closes — yields across polls until aborted', async () => {
    const controller = new AbortController();
    const gen = await tailNotifications(userId, null, controller.signal);

    await seedRaw(userId, hoursAhead(1), 'one');
    const r1 = await gen.next();
    expect(entryOf(r1).event.message).toBe('one');

    // Still open: a later entry is delivered without restarting the reader.
    await seedRaw(userId, hoursAhead(2), 'two');
    const r2 = await gen.next();
    expect(entryOf(r2).event.message).toBe('two');

    // Only an abort closes it.
    controller.abort();
    const r3 = await gen.next();
    expect(r3.done).toBe(true);
  });

  it('is immune to host/Redis clock skew — a fresh reader still skips the backlog and delivers new (#196)', async () => {
    // The old fresh-connect seed was `${Date.now()}-0` — the APP clock, while
    // Redis assigns ids from its OWN. Under podman-VM drift that seed landed in
    // Redis' future and every real entry was silently dropped. The seed is now the
    // stream's actual last id, so even a wildly skewed app clock changes nothing.
    await publish(userId, { kind: 'test', level: 'info', message: 'backlog' });

    // Simulate the host clock running an hour ahead of Redis.
    const skew = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 60 * 60 * 1000);

    const controller = new AbortController();
    const gen = await tailNotifications(userId, null, controller.signal);

    // A new entry, minted with a real Redis id AFTER attach.
    await publish(userId, { kind: 'test', level: 'info', message: 'live' });

    const first = await gen.next();
    controller.abort();
    skew.mockRestore();

    // Under the old Date.now() seed this reader would have yielded nothing.
    expect(entryOf(first).event.message).toBe('live');
  });
});
