/**
 * Ingest progress reader — service (integration) test.
 *
 * Drives the real `tailIngestProgress` generator against a real Redis Stream,
 * seeded through the real `createIngestProgressWriter` (so the sole-`xAdd` + rolling
 * TTL producer is exercised on the way in). The tRPC subscription wrapping is not
 * tested e2e — the generator body is the contract. The reader never self-closes
 * (no per-Job terminal on this stream), so every drain is bounded by an abort.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { redis } from '@acme/redis';

import type { IngestProgressEntry } from '../../../../api/services/ingest-progress-parser';
import { ingestProgressKey } from '../../../../api/ingest-keys';
import { tailIngestProgress } from '../../../../api/services/ingest-progress-reader';
import { createIngestProgressWriter } from '../../../../api/services/ingest-progress-writer';
import { cleanupTestData } from '../../utils/test-context';

const userId = 'user-1';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await delay(10);
  }
}

// Drive the reader from a given cursor until it has re-emitted `until` entries,
// then abort so the (never-self-closing) generator returns. A safety timeout keeps
// a missed expectation from hanging the suite.
async function drainFromCursor(
  lastEventId: string | null,
  until: number,
): Promise<IngestProgressEntry[]> {
  const controller = new AbortController();
  const safety = setTimeout(() => controller.abort(), 2000);
  const out: IngestProgressEntry[] = [];
  for await (const entry of tailIngestProgress(
    userId,
    lastEventId,
    controller.signal,
  )) {
    out.push(entry);
    if (out.length >= until) controller.abort();
  }
  clearTimeout(safety);
  return out;
}

describe('tailIngestProgress (integration)', () => {
  beforeEach(async () => {
    await cleanupTestData();
  });
  afterEach(async () => {
    await cleanupTestData();
  });

  it('re-emits the full per-file stage sequence in order', async () => {
    const writer = createIngestProgressWriter(userId, 'job-1');
    await writer.queued('u1', 'a.pdf');
    await writer.stage('u1', 'a.pdf', 'parsing');
    await writer.stage('u1', 'a.pdf', 'embedding');
    await writer.done('u1', 'a.pdf');
    await writer.failed('u2', 'b.pdf', 'bad file');

    // A cursor of '0-0' resumes from the head, so a seed-then-drain sees everything.
    const out = await drainFromCursor('0-0', 5);

    expect(out.map((entry) => entry.event.stage)).toEqual([
      'queued',
      'parsing',
      'embedding',
      'done',
      'failed',
    ]);
    expect(out[4]?.event).toMatchObject({
      stage: 'failed',
      uploadId: 'u2',
      filename: 'b.pdf',
      error: 'bad file',
    });
  });

  it('stamps a rolling TTL on every append (never persists forever)', async () => {
    const writer = createIngestProgressWriter(userId, 'job-ttl');
    await writer.queued('u1', 'a.pdf');

    const ttl = await redis.ttl(ingestProgressKey(userId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it('rolls a decayed TTL back up on the next append', async () => {
    const key = ingestProgressKey(userId);
    const writer = createIngestProgressWriter(userId, 'job-roll');
    await writer.queued('u1', 'a.pdf');

    // Force the TTL to decay near expiry, then append again: a rolling TTL must
    // refresh the countdown, not leave the stream to die on the old clock. (A
    // non-rolling writer, or a lost `expire`, would leave the TTL at ~5s.)
    await redis.expire(key, 5);
    expect(await redis.ttl(key)).toBeLessThanOrEqual(5);

    await writer.stage('u1', 'a.pdf', 'parsing');
    expect(await redis.ttl(key)).toBeGreaterThan(5);
  });

  it('resumes strictly after lastEventId on a transient reconnect', async () => {
    const writer = createIngestProgressWriter(userId, 'job-r');
    await writer.queued('u1', 'a.pdf');
    await writer.stage('u1', 'a.pdf', 'parsing');

    const first = await drainFromCursor('0-0', 2);
    expect(first).toHaveLength(2);
    const lastId = first[1]?.id ?? null;

    await writer.stage('u1', 'a.pdf', 'embedding');
    await writer.done('u1', 'a.pdf');

    // Resuming from the last-seen id re-reads neither queued nor parsing.
    const resumed = await drainFromCursor(lastId, 2);
    expect(resumed.map((entry) => entry.event.stage)).toEqual([
      'embedding',
      'done',
    ]);
  });

  it('tails from now — appends before the mount are not delivered', async () => {
    // Seed a stage BEFORE the reader mounts.
    const before = createIngestProgressWriter(userId, 'job-before');
    await before.queued('u-before', 'before.pdf');

    // The reader seeds a fresh mount's cursor from `Date.now()`, but Redis assigns
    // stream ids from ITS OWN clock — in a container those clocks skew, so a
    // wall-clock gap is not a reliable boundary. Pin the reader's mount clock to
    // just past the before-entry's real Redis id, so both the cursor and the entry
    // ids live on the one Redis timeline; restore before anything else reads time.
    const [firstEntry] = await redis.xRange(
      ingestProgressKey(userId),
      '-',
      '+',
    );
    const beforeMs = Number(firstEntry?.[0]?.split('-')[0]);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(beforeMs + 1);

    const controller = new AbortController();
    const out: IngestProgressEntry[] = [];
    const drained = (async () => {
      for await (const entry of tailIngestProgress(
        userId,
        null,
        controller.signal,
      )) {
        out.push(entry);
      }
    })();

    // The generator reads Date.now() synchronously when the first pull starts;
    // yield one tick so that has happened, then restore the real clock.
    await delay(0);
    nowSpy.mockRestore();

    // Real time advances past the pinned cursor, so these appends are delivered.
    await delay(5);
    const after = createIngestProgressWriter(userId, 'job-after');
    await after.queued('u-after', 'after.pdf');
    await after.done('u-after', 'after.pdf');

    await waitFor(() => out.length >= 2);
    controller.abort();
    await drained;

    const filenames = out.map((entry) => entry.event.filename);
    expect(filenames).not.toContain('before.pdf');
    expect(out.map((entry) => entry.event.stage)).toEqual(['queued', 'done']);
  });
});
