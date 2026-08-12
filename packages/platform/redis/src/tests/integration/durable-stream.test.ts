import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StreamCodec, StreamEntry } from '../../durable-stream';
import { nsKey } from '../../client';
import { createDurableStream, HEAD_CURSOR } from '../../durable-stream';
import { flushTestDb } from '../../testing';

/**
 * Durable-stream primitive — integration test against a REAL Redis (the isolated
 * logical DB from this suite's vitest config), no mocks: the whole point is the
 * round-trip through a live stream. This is the single place the shared poll
 * loop, the cursor-seed policies, the abort-aware `delay`, and the encode/parse
 * round-trip are tested — the three consumers (chat/ingest/notifications) inherit
 * it instead of re-testing their own copies.
 */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await delay(10);
  }
}

// A tiny discriminated wire shape, encoded/decoded through the primitive exactly
// as a real caller would — one field is always present, one rides conditionally,
// exercising the fold + validate round-trip.
interface Evt {
  kind: 'tick' | 'end';
  note?: string;
}

const codec: StreamCodec<Evt> = {
  encode: (event) => {
    const fields: Record<string, string> = { kind: event.kind };
    if (event.note !== undefined) fields.note = event.note;
    return fields;
  },
  decode: (fields) => {
    const kind = fields.kind;
    if (kind !== 'tick' && kind !== 'end') {
      throw new Error(`bad kind: ${kind}`);
    }
    return fields.note === undefined ? { kind } : { kind, note: fields.note };
  },
};

const makeStream = (suffix: string) =>
  createDurableStream<Evt>({
    key: nsKey('durable-stream-test', suffix),
    ttlSeconds: 60,
    codec,
  });

// Drain a tail generator in the background into an array until aborted/closed.
function drainInto(
  gen: AsyncGenerator<StreamEntry<Evt>>,
  sink: StreamEntry<Evt>[],
) {
  return (async () => {
    for await (const entry of gen) sink.push(entry);
  })();
}

beforeEach(async () => {
  await flushTestDb();
});
afterEach(async () => {
  await flushTestDb();
});

describe('write + read round-trip', () => {
  it('decodes back exactly what was written, in order', async () => {
    const stream = makeStream('roundtrip');
    await stream.write({ kind: 'tick', note: 'a' });
    await stream.write({ kind: 'tick' });
    await stream.write({ kind: 'end', note: 'z' });

    const entries = await stream.read();
    expect(entries.map((e) => e.event)).toStrictEqual([
      { kind: 'tick', note: 'a' },
      { kind: 'tick' },
      { kind: 'end', note: 'z' },
    ]);
  });
});

describe('lastId — the fresh-connect seed source', () => {
  it('is null on an empty stream and the highest real id once written', async () => {
    const stream = makeStream('lastid');
    expect(await stream.lastId()).toBeNull();

    await stream.write({ kind: 'tick' });
    await stream.write({ kind: 'end' });

    const entries = await stream.read();
    expect(await stream.lastId()).toBe(entries.at(-1)?.id);
  });
});

describe('tail cursor-seed policies', () => {
  it('HEAD_CURSOR replays the whole backlog then follows live appends', async () => {
    const stream = makeStream('head');
    await stream.write({ kind: 'tick', note: '1' });
    await stream.write({ kind: 'tick', note: '2' });

    const controller = new AbortController();
    const seen: StreamEntry<Evt>[] = [];
    const done = drainInto(
      stream.tail(HEAD_CURSOR, {
        pollMinMs: 20,
        pollMaxMs: 40,
        signal: controller.signal,
      }),
      seen,
    );

    await waitFor(() => seen.length === 2);
    await stream.write({ kind: 'tick', note: '3' });
    await waitFor(() => seen.length === 3);
    controller.abort();
    await done;

    expect(seen.map((e) => e.event.note)).toStrictEqual(['1', '2', '3']);
  });

  it('seeding from lastId skips the backlog and delivers only new entries', async () => {
    // This is the notifications tail-from-now policy — and its clock-skew fix:
    // the seed is a REAL Redis id, not `Date.now()`, so a host/Redis clock drift
    // can never place the cursor in Redis' future and drop live events.
    const stream = makeStream('lastid-seed');
    await stream.write({ kind: 'tick', note: 'old-1' });
    await stream.write({ kind: 'tick', note: 'old-2' });
    const seed = (await stream.lastId()) ?? HEAD_CURSOR;

    const controller = new AbortController();
    const seen: StreamEntry<Evt>[] = [];
    const done = drainInto(
      stream.tail(seed, {
        pollMinMs: 20,
        pollMaxMs: 40,
        signal: controller.signal,
      }),
      seen,
    );

    await stream.write({ kind: 'tick', note: 'new-1' });
    await waitFor(() => seen.length === 1);
    controller.abort();
    await done;

    expect(seen.map((e) => e.event.note)).toStrictEqual(['new-1']);
  });
});

describe('tail transform', () => {
  it('coalesces a batch before yielding, carrying the last raw id', async () => {
    const stream = makeStream('transform');
    await stream.write({ kind: 'tick', note: 'a' });
    await stream.write({ kind: 'tick', note: 'b' });
    await stream.write({ kind: 'tick', note: 'c' });

    // Collapse a whole batch of ticks into one, tagged with the LAST id.
    const coalesce = (batch: StreamEntry<Evt>[]): StreamEntry<Evt>[] => {
      const last = batch.at(-1);
      if (!last) return [];
      const note = batch.map((e) => e.event.note).join('');
      return [{ id: last.id, event: { kind: 'tick', note } }];
    };

    const controller = new AbortController();
    const seen: StreamEntry<Evt>[] = [];
    const done = drainInto(
      stream.tail(HEAD_CURSOR, {
        pollMinMs: 20,
        pollMaxMs: 40,
        signal: controller.signal,
        transform: coalesce,
      }),
      seen,
    );

    await waitFor(() => seen.length === 1);
    const lastId = (await stream.read()).at(-1)?.id;
    expect(seen[0]?.event.note).toBe('abc');
    // Cursor advanced past the whole batch even though 2 of 3 were coalesced away.
    expect(seen[0]?.id).toBe(lastId);
    controller.abort();
    await done;
  });
});

describe('tail keepGoing', () => {
  it('closes after exactly one more drain once the predicate returns false', async () => {
    const stream = makeStream('keepgoing');
    await stream.write({ kind: 'tick', note: 'live' });

    let live = true;
    const seen: StreamEntry<Evt>[] = [];
    const gen = stream.tail(HEAD_CURSOR, {
      pollMinMs: 20,
      pollMaxMs: 20,
      keepGoing: () => live,
    });
    const done = drainInto(gen, seen);

    await waitFor(() => seen.length === 1);
    // Flip the predicate AND append a final entry: the one-more-drain must catch
    // an entry written just before the source went away, then close on its own.
    live = false;
    await stream.write({ kind: 'end', note: 'last' });
    await done; // self-closes — no abort

    expect(seen.map((e) => e.event.note)).toStrictEqual(['live', 'last']);
  });
});

describe('tail abort', () => {
  it('settles the poll delay and closes promptly on abort', async () => {
    const stream = makeStream('abort');
    const controller = new AbortController();
    const seen: StreamEntry<Evt>[] = [];
    // Long poll interval: only the abort-aware delay can close this quickly.
    const done = drainInto(
      stream.tail(HEAD_CURSOR, {
        pollMinMs: 10_000,
        pollMaxMs: 10_000,
        signal: controller.signal,
      }),
      seen,
    );

    await delay(50);
    const start = Date.now();
    controller.abort();
    await done;
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
