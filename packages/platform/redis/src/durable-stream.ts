import type { NamespacedKey } from './client';
import { redis } from './client';

// One durable per-user (or per-conversation) Redis Stream primitive, shared by
// chat's token stream, ingest's progress stream, and the notifications stream.
// Before this each feature hand-copied the same triplet — an XRANGE poll loop, a
// byte-identical abort-aware `delay`, the same cursor/`rangeStart` logic, and an
// encode/parse pair off one zod schema — so a fix in one (the `${Date.now()}-0`
// clock-skew cursor, the non-atomic `xAdd`+`expire`) never reached the others.
// This owns the transport once; each caller supplies only what is genuinely its
// own: the wire codec, the fresh-connect cursor seed, and (optionally) a
// keep-tailing predicate and a per-batch transform.

// A parsed, id-tagged stream entry: the `id` a reader hands to tRPC `tracked()`
// as the SSE resume cursor, and the decoded event it carries.
export interface StreamEntry<T> {
  id: string;
  event: T;
}

// The wire codec — the caller's one home for the encode/parse pair, both typed
// off its own zod schema. `encode` is the inverse of `decode`. Fields ride on the
// wire as a flat Redis hash (`Record<string,string>`); the primitive folds the
// raw `[k, v, …]` array to a record before `decode` so every caller shares the
// fold. A caller whose payload is nested (notifications) JSON-encodes it into a
// single field here.
export interface StreamCodec<T> {
  encode: (event: T) => Record<string, string>;
  decode: (fields: Record<string, string>) => T;
}

export interface TailOptions<T> {
  // Idle poll backoff: doubles from `pollMinMs` toward `pollMaxMs` while the
  // stream is empty, snaps back to `pollMinMs` when a batch arrives. Set both
  // equal for a fixed cadence (chat, while a Turn is in-flight).
  pollMinMs: number;
  pollMaxMs: number;
  // Torn down when the client disconnects; the abort settles the poll `delay`
  // within one tick rather than after the full interval.
  signal?: AbortSignal;
  // Optional predicate probed after each drained batch to decide whether to keep
  // tailing. Returning `false` takes exactly ONE more (sleepless) drain — to
  // catch an entry written just before the source went away — then closes. Chat
  // supplies its in-flight-Turn lock probe here, so the reader stops reaching
  // into the Turn control plane itself. Omitted ⇒ tail forever (ingest,
  // notifications: only client abort closes them).
  keepGoing?: (cursor: string) => boolean | Promise<boolean>;
  // Optional map/coalesce over a decoded batch before it is yielded. Chat passes
  // its delta-coalesce (one xRange of backlog ⇒ one render); ingest and
  // notifications pass nothing (identity). The last yielded id must not precede
  // the last raw id of the batch — the cursor always advances past the whole
  // batch regardless, so a coalesced-away entry is never re-read.
  transform?: (batch: StreamEntry<T>[]) => Iterable<StreamEntry<T>>;
}

// Fold a raw ioredis `[k, v, k, v, …]` field array to a record. Shared by every
// caller's `decode` — the fold that used to be re-copied in each parser. Built
// from entry pairs (not bracket assignment) so a field name can't reach a
// prototype key.
const foldFields = (fields: string[]) => {
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const key = fields.at(i);
    const value = fields.at(i + 1);
    if (key !== undefined && value !== undefined) pairs.push([key, value]);
  }
  return Object.fromEntries<string>(pairs);
};

// A delay that also settles early on abort, so a disconnecting client tears the
// reader down within one tick rather than after the full poll interval. The one
// home of this timer — it was byte-identical in all three readers before.
const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

// '0-0' reads from the head: no real Redis entry id is <= 0-0, so an exclusive
// `(0-0` start yields the whole stream. Every cursor the primitive tails from is
// a REAL Redis id (a resume `lastEventId`, a snapshot `lastId`, or `lastId()`) or
// this head sentinel — never an app-clock `Date.now()` that skews against Redis.
export const HEAD_CURSOR = '0-0';

export interface DurableStreamOptions<T> {
  key: NamespacedKey;
  // Rolling TTL restamped atomically with every append, so an abandoned stream
  // self-expires and a crash between append and expire can never leave it
  // immortal (see `xAddWithTtl`).
  ttlSeconds: number;
  codec: StreamCodec<T>;
  // Approximate MAXLEN trim on each append. Omit for an unbounded (TTL-only)
  // stream.
  maxlen?: number;
}

export function createDurableStream<T>({
  key,
  ttlSeconds,
  codec,
  maxlen,
}: DurableStreamOptions<T>) {
  const decodeEntry = ([id, fields]: readonly [string, string[]]) => ({
    id,
    event: codec.decode(foldFields(fields)),
  });

  return {
    // The SOLE append: atomic append-with-rolling-TTL for every consumer.
    async write(event: T) {
      await redis.xAddWithTtl(
        key,
        '*',
        codec.encode(event),
        ttlSeconds,
        maxlen === undefined ? undefined : { MAXLEN: maxlen },
      );
    },

    // The last (highest) stream id, or null on an empty stream — a real
    // Redis-assigned id a fresh tail-from-now reader seeds its cursor from
    // instead of the app clock (notifications). `XREVRANGE + - COUNT 1`.
    async lastId(): Promise<string | null> {
      const [entry] = await redis.xRevRange(key, '+', '-', { COUNT: 1 });
      return entry?.[0] ?? null;
    },

    // Decoded snapshot of a full id range (default: the whole stream). Ingest's
    // cold-mount fold reads the retained stream through this.
    async read(start = '-', end = '+'): Promise<StreamEntry<T>[]> {
      const entries = await redis.xRange(key, start, end);
      return entries.map((entry) => decodeEntry(entry));
    },

    // Poll-tail the stream from `startCursor` (exclusive), yielding each decoded
    // entry. `startCursor` is the caller's cursor-seed policy made concrete — a
    // real Redis id or `HEAD_CURSOR`. Never issues a blocking XREAD (the shared
    // connection must not stall); polls XRANGE with the idle backoff instead.
    async *tail(
      startCursor: string,
      { pollMinMs, pollMaxMs, signal, keepGoing, transform }: TailOptions<T>,
    ): AsyncGenerator<StreamEntry<T>> {
      let cursor = startCursor;
      let idleMs = pollMinMs;
      // Once `keepGoing` says stop we take exactly one more drain, then close.
      let draining = false;

      while (!signal?.aborted) {
        const entries = await redis.xRange(key, `(${cursor}`, '+');
        const batch = entries.map((entry) => decodeEntry(entry));

        for (const entry of transform ? transform(batch) : batch) {
          yield entry;
        }
        // Advance past the WHOLE batch — a `transform` may coalesce away the last
        // raw entry, so trusting the last yielded id could re-read it.
        const lastRaw = entries.at(-1);
        if (lastRaw) cursor = lastRaw[0];

        if (draining) return;

        if (keepGoing && !(await keepGoing(cursor))) {
          draining = true;
          continue;
        }

        idleMs =
          entries.length > 0 ? pollMinMs : Math.min(idleMs * 2, pollMaxMs);
        await delay(idleMs, signal);
      }
    },
  };
}
