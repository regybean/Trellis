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

import type { IngestProgressEntry } from '../../../../api/services/ingest-progress-stream';
import { ingestProgressKey } from '../../../../api/ingest-keys';
import {
  createIngestProgressWriter,
  tailIngestProgress,
} from '../../../../api/services/ingest-progress-stream';
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
// a missed expectation from hanging the suite. The cursor is the reader's options
// object: `sinceId` is the fresh-mount snapshot cursor, `lastEventId` the reconnect
// cursor (which takes precedence) — see tailIngestProgress.
async function drainFromCursor(
  cursor: { lastEventId?: string | null; sinceId?: string | null },
  until: number,
): Promise<IngestProgressEntry[]> {
  const controller = new AbortController();
  const safety = setTimeout(() => controller.abort(), 2000);
  const out: IngestProgressEntry[] = [];
  for await (const entry of tailIngestProgress(
    userId,
    cursor,
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
    const out = await drainFromCursor({ sinceId: '0-0' }, 5);

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

    const first = await drainFromCursor({ sinceId: '0-0' }, 2);
    expect(first).toHaveLength(2);
    const lastId = first[1]?.id ?? null;

    await writer.stage('u1', 'a.pdf', 'embedding');
    await writer.done('u1', 'a.pdf');

    // Resuming from the last-seen id (via `lastEventId`) re-reads neither queued
    // nor parsing — and `lastEventId` takes precedence over any `sinceId`.
    const resumed = await drainFromCursor(
      { lastEventId: lastId, sinceId: '0-0' },
      2,
    );
    expect(resumed.map((entry) => entry.event.stage)).toEqual([
      'embedding',
      'done',
    ]);
  });

  it('a fresh mount resumes strictly after the snapshot lastId (#194)', async () => {
    // Mirrors the client's cold-mount: fold the retained stream, take its lastId,
    // then tail from it — prior stages are seeded from the snapshot, not replayed.
    const writer = createIngestProgressWriter(userId, 'job-s');
    await writer.queued('u1', 'a.pdf');
    await writer.stage('u1', 'a.pdf', 'parsing');

    const entries = await redis.xRange(ingestProgressKey(userId), '-', '+');
    const lastId = entries.at(-1)?.[0] ?? '0-0';

    await writer.stage('u1', 'a.pdf', 'embedding');
    await writer.done('u1', 'a.pdf');

    const resumed = await drainFromCursor({ sinceId: lastId }, 2);
    expect(resumed.map((entry) => entry.event.stage)).toEqual([
      'embedding',
      'done',
    ]);
  });

  it('is immune to app-clock skew — a future Date.now() no longer drops events (#194)', async () => {
    // The old fresh-mount cursor was `${Date.now()}-0`; under podman-VM clock skew
    // that landed in Redis' future and dropped every real stage event. The cursor
    // is now a real stream id, so even a wildly skewed app clock changes nothing.
    const skew = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 60 * 60 * 1000);

    const controller = new AbortController();
    const out: IngestProgressEntry[] = [];
    const drained = (async () => {
      for await (const entry of tailIngestProgress(
        userId,
        { sinceId: '0-0' },
        controller.signal,
      )) {
        out.push(entry);
      }
    })();

    const writer = createIngestProgressWriter(userId, 'job-skew');
    await writer.queued('u1', 'a.pdf');
    await writer.done('u1', 'a.pdf');

    await waitFor(() => out.length >= 2);
    controller.abort();
    await drained;
    skew.mockRestore();

    // Under the old Date.now() cursor `out` would be empty here.
    expect(out.map((entry) => entry.event.stage)).toEqual(['queued', 'done']);
  });
});
