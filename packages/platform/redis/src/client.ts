/* eslint-disable unicorn/prefer-top-level-await */
import type { SetOptions } from 'redis';
import { createClient } from 'redis';

import { logger } from '@acme/logger';

import { env } from './env';

const redisOptions = {
  url: env.REDIS_URL,
  socket: {
    reconnectStrategy(retries: number) {
      return Math.min(retries * 200, 2000);
    },
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

type RawClient = ReturnType<typeof createClient>;

/**
 * Wrap a raw node-redis client in a thin facade whose key/channel commands
 * accept only a `NamespacedKey`. node-redis has no built-in keyPrefix (that is
 * an ioredis feature); rather than a Proxy guarded by a hand-maintained command
 * allow-list (which silently leaked unprefixed keys for any unlisted command —
 * see ADR 0008), the prefix lives in `nsKey` and the type system enforces that
 * only prefixed keys reach the client. Infra methods pass through untouched.
 */
const namespaced = (raw: RawClient) => ({
  // Key commands — first argument is a key.
  get: (key: NamespacedKey) => raw.get(key),
  set: (key: NamespacedKey, value: string, options?: SetOptions) =>
    raw.set(key, value, options),
  decrBy: (key: NamespacedKey, decrement: number) => raw.decrBy(key, decrement),
  incrBy: (key: NamespacedKey, increment: number) => raw.incrBy(key, increment),
  del: (key: NamespacedKey) => raw.del(key),
  ttl: (key: NamespacedKey) => raw.ttl(key),
  expire: (key: NamespacedKey, seconds: number) => raw.expire(key, seconds),
  expireAt: (key: NamespacedKey, timestamp: number) =>
    raw.expireAt(key, timestamp),
  exists: (key: NamespacedKey) => raw.exists(key),
  // Channel commands — first argument is a channel.
  publish: (channel: NamespacedKey, message: string) =>
    raw.publish(channel, message),
  subscribe: (
    channel: NamespacedKey,
    listener: Parameters<RawClient['subscribe']>[1],
  ) => raw.subscribe(channel, listener),
  pSubscribe: (
    pattern: NamespacedKey,
    listener: Parameters<RawClient['pSubscribe']>[1],
  ) => raw.pSubscribe(pattern, listener),
  unsubscribe: (channel: NamespacedKey) => raw.unsubscribe(channel),
  pUnsubscribe: (pattern: NamespacedKey) => raw.pUnsubscribe(pattern),
  // Infra — not key-bearing, passed straight through.
  get isOpen() {
    return raw.isOpen;
  },
  connect: () => raw.connect(),
  flushDb: () => raw.flushDb(),
  ping: () => raw.ping(),
  quit: () => raw.quit(),
});
// `duplicate`/`on` are intentionally NOT surfaced: they hand back the raw,
// unbranded client and would be a hole in the namespace guarantee. The pub/sub
// clients are duplicated from the raw client below, then wrapped.

const rawRedis = createClient(redisOptions);
const rawRedisPub = rawRedis.duplicate();
const rawRedisSub = rawRedis.duplicate();

const attachErrorHandler = (label: string, client: typeof rawRedis) => {
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
