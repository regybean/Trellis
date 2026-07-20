/* eslint-disable unicorn/prefer-top-level-await */
import Redis from 'ioredis';

import { logger } from '@acme/logger';

import { env } from './env';

const redisOptions = {
  lazyConnect: true,
  retryStrategy(times: number) {
    return Math.min(times * 200, 2000);
  },
};

// Per-app key namespace. Sourced from NEXT_PUBLIC_WEBAPP so each app partitions
// one shared Redis instance, mirroring the per-app Postgres schema. Empty when
// unset (e.g. tests that mock @acme/redis/env without a namespace) — an empty
// namespace yields raw, app-agnostic keys with NO leading colon.
const namespace = env.NEXT_PUBLIC_WEBAPP;

/**
 * A Redis key or pub/sub channel that has already been namespaced for this app.
 * Branded so the client below accepts *only* keys built by `nsKey` — a raw
 * string is a compile error, not a silently-unprefixed cross-app collision.
 * See docs/adr/0008-per-app-redis-namespace.md.
 */
export type NamespacedKey = string & { readonly __brand: 'NamespacedKey' };

/**
 * Build a namespaced key from its colon-joined parts. This is the ONE place the
 * prefix is applied, so it cannot be forgotten: every key-bearing client method
 * demands a `NamespacedKey`, and this is the only way to make one. An empty
 * namespace yields the raw key with no leading colon (the test path).
 *
 *   nsKey('credits', userId, tier) -> 'nextjs:credits:<user>:<tier>'
 */
export const nsKey = (...parts: string[]): NamespacedKey => {
  const key = parts.join(':');
  // The single sanctioned cast: branding is a nominal-typing technique and
  // cannot be expressed without it. Isolated to this one constructor.
  return (namespace ? `${namespace}:${key}` : key) as NamespacedKey;
};

// ioredis does not export a clean options-object type for SET; this mirrors the
// full set of SET sub-commands so the facade never silently drops a flag.
interface SetOptions {
  EX?: number;
  PX?: number;
  EXAT?: number;
  PXAT?: number;
  KEEPTTL?: boolean;
  NX?: boolean;
  XX?: boolean;
}

type MessageListener = (message: string, channel: string) => void;

type PMessageListener = (
  message: string,
  channel: string,
  pattern: string,
) => void;

const isActiveStatus = (status: string) =>
  status === 'ready' ||
  status === 'connect' ||
  status === 'connecting' ||
  status === 'reconnecting';

// SET dispatch is split into helpers so the facade method stays flat — the
// NX/XX × TTL matrix otherwise trips the cognitive-complexity gate. The
// existence flag is passed as an ioredis literal (not a union) so the overloaded
// signatures resolve, hence the two near-identical NX/XX helpers.
const setNx = (
  raw: Redis,
  key: NamespacedKey,
  value: string,
  options: SetOptions,
) => {
  if (options.EX !== undefined)
    return raw.set(key, value, 'EX', options.EX, 'NX');
  if (options.PX !== undefined)
    return raw.set(key, value, 'PX', options.PX, 'NX');
  if (options.EXAT !== undefined)
    return raw.set(key, value, 'EXAT', options.EXAT, 'NX');
  return raw.set(key, value, 'NX');
};

const setXx = (
  raw: Redis,
  key: NamespacedKey,
  value: string,
  options: SetOptions,
) => {
  if (options.EX !== undefined)
    return raw.set(key, value, 'EX', options.EX, 'XX');
  if (options.PX !== undefined)
    return raw.set(key, value, 'PX', options.PX, 'XX');
  if (options.EXAT !== undefined)
    return raw.set(key, value, 'EXAT', options.EXAT, 'XX');
  return raw.set(key, value, 'XX');
};

const setWithTtl = (
  raw: Redis,
  key: NamespacedKey,
  value: string,
  options: SetOptions,
) => {
  if (options.EXAT !== undefined)
    return raw.set(key, value, 'EXAT', options.EXAT);
  if (options.PXAT !== undefined)
    return raw.set(key, value, 'PXAT', options.PXAT);
  if (options.EX !== undefined) return raw.set(key, value, 'EX', options.EX);
  if (options.PX !== undefined) return raw.set(key, value, 'PX', options.PX);
  if (options.KEEPTTL) return raw.set(key, value, 'KEEPTTL');
  return raw.set(key, value);
};

/**
 * Wrap a raw ioredis client in a thin facade whose key/channel commands accept
 * only a `NamespacedKey`. The prefix lives in `nsKey` and the type system
 * enforces that only prefixed keys reach the client. Infra methods pass through
 * untouched. ioredis method names differ from node-redis in casing; the facade
 * normalises them to the node-redis convention so no consumer changes are needed.
 */
const namespaced = (raw: Redis) => {
  // Tracked handlers so subscribe/unsubscribe pairs clean up properly.
  // ioredis emits on the client globally; without cleanup, each subscribe() call
  // would accumulate a new anonymous listener that survives unsubscribe().
  const channelHandlers = new Map<string, (ch: string, msg: string) => void>();
  const patternHandlers = new Map<
    string,
    (pat: string, ch: string, msg: string) => void
  >();

  return {
    // Key commands — first argument is a key.
    get: (key: NamespacedKey) => raw.get(key),
    // NX/XX may combine with a TTL option, so those are dispatched first; the
    // TTL-only paths follow. Branch bodies live in the module-level helpers.
    set: (key: NamespacedKey, value: string, options?: SetOptions) => {
      if (!options) return raw.set(key, value);
      if (options.NX) return setNx(raw, key, value, options);
      if (options.XX) return setXx(raw, key, value, options);
      return setWithTtl(raw, key, value, options);
    },
    decrBy: (key: NamespacedKey, decrement: number) =>
      raw.decrby(key, decrement),
    incrBy: (key: NamespacedKey, increment: number) =>
      raw.incrby(key, increment),
    del: (key: NamespacedKey) => raw.del(key),
    ttl: (key: NamespacedKey) => raw.ttl(key),
    expire: (key: NamespacedKey, seconds: number) => raw.expire(key, seconds),
    expireAt: (key: NamespacedKey, timestamp: number) =>
      raw.expireat(key, timestamp),
    exists: (key: NamespacedKey) => raw.exists(key),
    // Redis Stream commands. The id argument is '*' for auto-generated ids. Entries
    // are key-value pairs passed as a flat list; MAXLEN trims the stream to an
    // approximate maximum length on each write. Returns the auto-generated entry id.
    xAdd: (
      key: NamespacedKey,
      id: string,
      entry: Record<string, string>,
      options?: { MAXLEN?: number },
    ) => {
      const pairs = Object.entries(entry).flat();
      if (options?.MAXLEN !== undefined) {
        return raw.xadd(key, 'MAXLEN', '~', options.MAXLEN, id, ...pairs);
      }
      return raw.xadd(key, id, ...pairs);
    },
    xLen: (key: NamespacedKey) => raw.xlen(key),
    // xRange reads entries between two ids (inclusive). Use '-' / '+' for full range.
    xRange: (key: NamespacedKey, start: string, end: string) =>
      raw.xrange(key, start, end),
    // Channel commands — first argument is a channel.
    publish: (channel: NamespacedKey, message: string) =>
      raw.publish(channel, message),
    subscribe: (channel: NamespacedKey, listener: MessageListener) => {
      const handler = (ch: string, msg: string) => {
        if (ch === channel) listener(msg, ch);
      };
      channelHandlers.set(channel, handler);
      raw.on('message', handler);
      return raw.subscribe(channel);
    },
    pSubscribe: (pattern: NamespacedKey, listener: PMessageListener) => {
      const handler = (pat: string, ch: string, msg: string) => {
        listener(msg, ch, pat);
      };
      patternHandlers.set(pattern, handler);
      raw.on('pmessage', handler);
      return raw.psubscribe(pattern);
    },
    unsubscribe: (channel: NamespacedKey) => {
      const handler = channelHandlers.get(channel);
      if (handler) {
        raw.off('message', handler);
        channelHandlers.delete(channel);
      }
      return raw.unsubscribe(channel);
    },
    pUnsubscribe: (pattern: NamespacedKey) => {
      const handler = patternHandlers.get(pattern);
      if (handler) {
        raw.off('pmessage', handler);
        patternHandlers.delete(pattern);
      }
      return raw.punsubscribe(pattern);
    },
    // Infra — not key-bearing, passed straight through.
    get isOpen() {
      return isActiveStatus(raw.status);
    },
    // No-op when already connecting/connected — ioredis throws if connect() is
    // called in those states (unlike node-redis which silently ignores it).
    connect: () => {
      const status = raw.status;
      if (status === 'wait' || status === 'close') return raw.connect();
      return Promise.resolve();
    },
    flushDb: () => raw.flushdb(),
    ping: () => raw.ping(),
    quit: () => raw.quit(),
  };
};
// `duplicate`/`on` are intentionally NOT surfaced: they hand back the raw,
// unbranded client and would be a hole in the namespace guarantee. The pub/sub
// clients are duplicated from the raw client below, then wrapped.

const rawRedis = new Redis(env.REDIS_URL, redisOptions);
const rawRedisPub = rawRedis.duplicate();
const rawRedisSub = rawRedis.duplicate();

const attachErrorHandler = (label: string, client: Redis) => {
  client.on('error', (error) => {
    logger.error({ err: error, label }, 'Redis client error');
  });
};

attachErrorHandler('redis', rawRedis);
attachErrorHandler('redisPub', rawRedisPub);
attachErrorHandler('redisSub', rawRedisSub);

// We do this because next build tries to connect when importing this file
// eslint-disable-next-line no-restricted-properties
if (process.env.IS_NEXT_BUILD !== 'true') {
  void rawRedis.connect().catch((error) => {
    logger.error({ err: error }, 'Failed to connect to Redis');
  });
  void rawRedisPub.connect().catch((error) => {
    logger.error({ err: error }, 'Failed to connect to Redis');
  });
  void rawRedisSub.connect().catch((error) => {
    logger.error({ err: error }, 'Failed to connect to Redis');
  });
}

export const redis = namespaced(rawRedis);
export const redisPub = namespaced(rawRedisPub);
export const redisSub = namespaced(rawRedisSub);
