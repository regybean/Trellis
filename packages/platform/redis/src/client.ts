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

interface SetOptions {
  EXAT?: number;
}

type MessageListener = (message: string, channel: string) => void;

type PMessageListener = (
  message: string,
  channel: string,
  pattern: string,
) => void;

/**
 * Wrap a raw ioredis client in a thin facade whose key/channel commands accept
 * only a `NamespacedKey`. The prefix lives in `nsKey` and the type system
 * enforces that only prefixed keys reach the client. Infra methods pass through
 * untouched. ioredis method names differ from node-redis in casing; the facade
 * normalises them to the node-redis convention so no consumer changes are needed.
 */
const namespaced = (raw: Redis) => ({
  // Key commands — first argument is a key.
  get: (key: NamespacedKey) => raw.get(key),
  set: (key: NamespacedKey, value: string, options?: SetOptions) => {
    if (options?.EXAT !== undefined) {
      return raw.set(key, value, 'EXAT', options.EXAT);
    }
    return raw.set(key, value);
  },
  decrBy: (key: NamespacedKey, decrement: number) => raw.decrby(key, decrement),
  incrBy: (key: NamespacedKey, increment: number) => raw.incrby(key, increment),
  del: (key: NamespacedKey) => raw.del(key),
  ttl: (key: NamespacedKey) => raw.ttl(key),
  expire: (key: NamespacedKey, seconds: number) => raw.expire(key, seconds),
  expireAt: (key: NamespacedKey, timestamp: number) =>
    raw.expireat(key, timestamp),
  exists: (key: NamespacedKey) => raw.exists(key),
  // Channel commands — first argument is a channel.
  publish: (channel: NamespacedKey, message: string) =>
    raw.publish(channel, message),
  subscribe: (channel: NamespacedKey, listener: MessageListener) => {
    raw.on('message', (ch: string, msg: string) => {
      if (ch === channel) listener(msg, ch);
    });
    return raw.subscribe(channel);
  },
  pSubscribe: (pattern: NamespacedKey, listener: PMessageListener) => {
    raw.on('pmessage', (pat: string, ch: string, msg: string) => {
      listener(msg, ch, pat);
    });
    return raw.psubscribe(pattern);
  },
  unsubscribe: (channel: NamespacedKey) => raw.unsubscribe(channel),
  pUnsubscribe: (pattern: NamespacedKey) => raw.punsubscribe(pattern),
  // Infra — not key-bearing, passed straight through.
  get isOpen() {
    const s = raw.status;
    return (
      s === 'ready' ||
      s === 'connect' ||
      s === 'connecting' ||
      s === 'reconnecting'
    );
  },
  // No-op when already connecting/connected — ioredis throws if connect() is
  // called in those states (unlike node-redis which silently ignores it).
  connect: () => {
    const s = raw.status;
    if (s === 'wait' || s === 'close') return raw.connect();
    return Promise.resolve();
  },
  flushDb: () => raw.flushdb(),
  ping: () => raw.ping(),
  quit: () => raw.quit(),
});
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
