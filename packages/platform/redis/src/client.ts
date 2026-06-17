/* eslint-disable unicorn/prefer-top-level-await */
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
const withPrefix = (key: string): string =>
  namespace ? `${namespace}:${key}` : key;

// Commands whose first argument is a key/channel we must namespace. node-redis
// has no built-in keyPrefix (that's an ioredis feature), so we namespace by
// wrapping the client in a Proxy that rewrites the first string argument.
//
// GUARDRAIL: introducing a new key- or channel-bearing Redis command anywhere
// in the codebase? Add it to the matching set below, or its keys leak
// UNPREFIXED and collide across both apps.
const KEY_COMMANDS = new Set<string>([
  'get',
  'set',
  'decrBy',
  'incrBy',
  'del',
  'ttl',
  'expire',
  'exists',
]);
const CHANNEL_COMMANDS = new Set<string>([
  'publish',
  'subscribe',
  'pSubscribe',
  'unsubscribe',
  'pUnsubscribe',
]);

// Wrap a client so key/channel commands transparently get the app prefix. All
// other members (flushDb, duplicate, connect, on, multi, ping, …) pass through
// untouched. Call sites keep using literal keys; prefixing is invisible.
const withNamespace = <T extends object>(client: T): T =>
  new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      const command = typeof prop === 'string' ? prop : '';
      const fn = value as (...args: unknown[]) => unknown;
      if (KEY_COMMANDS.has(command) || CHANNEL_COMMANDS.has(command)) {
        return (...args: unknown[]): unknown => {
          const [first, ...rest] = args;
          const next =
            typeof first === 'string' ? [withPrefix(first), ...rest] : args;
          return fn.apply(target, next);
        };
      }
      return fn.bind(target);
    },
  });

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

export const redis = withNamespace(rawRedis);
export const redisPub = withNamespace(rawRedisPub);
export const redisSub = withNamespace(rawRedisSub);
