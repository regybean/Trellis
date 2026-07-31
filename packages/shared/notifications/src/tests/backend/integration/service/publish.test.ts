import { describe, expect, it } from 'vitest';

import { redis } from '@acme/redis';

import { notificationKey } from '../../../../api/notification-keys';
import { notificationSchema } from '../../../../api/schemas/notification-schema';
import { publish } from '../../../../api/services/publish';

const readEntries = (uid: string) =>
  redis.xRange(notificationKey(uid), '-', '+');

// `publish` against real Redis: the sole writer. We read the stream back with
// `xRange(notificationKey(userId))` and assert the envelope it wrote.
describe('publish', () => {
  const userId = 'user-publish';

  it('writes one entry, mints id + createdAt, as a single payload JSON field', async () => {
    await publish(userId, {
      kind: 'ingest.job-complete',
      level: 'success',
      message: '4 documents indexed',
      data: { jobId: 'job-1', total: 4 },
    });

    const entries = await readEntries(userId);
    expect(entries).toHaveLength(1);

    const [entry] = entries;
    if (!entry) throw new Error('expected one entry');
    const [, fields] = entry;
    // Exactly one field: `payload`. The nested `data` can't be a flat field map.
    const [key, value] = fields;
    expect(fields).toHaveLength(2);
    expect(key).toBe('payload');
    if (value === undefined) throw new Error('expected a payload value');

    const envelope = notificationSchema.parse(JSON.parse(value));
    expect(envelope.kind).toBe('ingest.job-complete');
    expect(envelope.level).toBe('success');
    expect(envelope.message).toBe('4 documents indexed');
    expect(envelope.data).toEqual({ jobId: 'job-1', total: 4 });
    // Server-minted: a non-empty id and a parseable ISO createdAt.
    expect(envelope.id).toMatch(/\S/);
    expect(Number.isNaN(Date.parse(envelope.createdAt))).toBe(false);
  });

  it('refreshes a rolling ~1h TTL on the stream key', async () => {
    await publish(userId, { kind: 'x', level: 'info', message: 'first' });
    const ttl = await redis.ttl(notificationKey(userId));
    // Positive and within the 1h window (config default 3600s).
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);

    // A second publish keeps the TTL rolling (still positive, not expired away).
    await publish(userId, { kind: 'x', level: 'info', message: 'second' });
    const ttl2 = await redis.ttl(notificationKey(userId));
    expect(ttl2).toBeGreaterThan(0);
    expect(ttl2).toBeLessThanOrEqual(3600);
  });

  it('rejects invalid input before writing (bad level)', async () => {
    await expect(
      // @ts-expect-error — exercising the runtime validation guard
      publish(userId, { kind: 'x', level: 'warning', message: 'nope' }),
    ).rejects.toThrow();
    expect(await readEntries(userId)).toHaveLength(0);
  });
});
