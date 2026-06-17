import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the per-app Redis key namespace.
 *
 * @acme/redis wraps each client in a Proxy that prefixes the first argument of
 * key- and channel-bearing commands with NEXT_PUBLIC_WEBAPP. These tests assert
 * the prefixing behaviour in both branches (namespace set vs empty) without
 * touching a real Redis — `redis` and `@acme/logger` are mocked, and
 * IS_NEXT_BUILD short-circuits the connect() side effect on import.
 */

// Skip the connect() side effect that runs on client.ts import.
process.env.IS_NEXT_BUILD = 'true';

interface Captured {
  method: string;
  args: unknown[];
}

const KEY_AND_CHANNEL_COMMANDS = [
  'get',
  'set',
  'decrBy',
  'incrBy',
  'del',
  'ttl',
  'expire',
  'exists',
  'publish',
  'subscribe',
  'pSubscribe',
  'unsubscribe',
  'pUnsubscribe',
];
const PASS_THROUGH_COMMANDS = ['flushDb', 'ping'];

const captured: Captured[] = [];

const makeFakeClient = () => {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      captured.push({ method, args });
      return undefined;
    };

  const client: Record<string, unknown> = {};
  for (const method of [
    ...KEY_AND_CHANNEL_COMMANDS,
    ...PASS_THROUGH_COMMANDS,
  ]) {
    client[method] = record(method);
  }
  client.on = vi.fn();
  client.connect = vi.fn().mockResolvedValue(undefined);
  client.duplicate = vi.fn(() => makeFakeClient());
  return client;
};

const loadClient = async (webapp: string | undefined) => {
  vi.resetModules();
  captured.length = 0;

  vi.doMock('@acme/logger', () => ({
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  }));
  vi.doMock('redis', () => ({
    createClient: vi.fn(() => makeFakeClient()),
  }));
  vi.doMock('../env', () => ({
    env: {
      REDIS_URL: 'redis://localhost:6379',
      NEXT_PUBLIC_WEBAPP: webapp,
    },
  }));

  return import('../client');
};

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('redis namespace wrapper', () => {
  describe('with a namespace set', () => {
    it('prefixes the key of key-bearing commands', async () => {
      const { redis } = await loadClient('nextjs');

      await redis.get('credits:user_1:pro');
      await redis.decrBy('credits:user_1:pro', 5);
      await redis.ttl('credits:user_1:pro');

      expect(captured).toEqual([
        { method: 'get', args: ['nextjs:credits:user_1:pro'] },
        { method: 'decrBy', args: ['nextjs:credits:user_1:pro', 5] },
        { method: 'ttl', args: ['nextjs:credits:user_1:pro'] },
      ]);
    });

    it('prefixes only the key and leaves trailing options untouched', async () => {
      const { redis } = await loadClient('tanstack-start');

      await redis.set('stripe:user:user_1', 'standard', { EXAT: 1234 });

      expect(captured).toEqual([
        {
          method: 'set',
          args: [
            'tanstack-start:stripe:user:user_1',
            'standard',
            { EXAT: 1234 },
          ],
        },
      ]);
    });

    it('prefixes the channel of channel-bearing commands, not the listener', async () => {
      const { redis } = await loadClient('nextjs');
      const listener = vi.fn();

      await redis.publish('jobs', 'payload');
      await redis.subscribe('jobs', listener);

      expect(captured).toEqual([
        { method: 'publish', args: ['nextjs:jobs', 'payload'] },
        { method: 'subscribe', args: ['nextjs:jobs', listener] },
      ]);
    });

    it('does not prefix pass-through commands', async () => {
      const { redis } = await loadClient('nextjs');

      await redis.flushDb();
      await redis.ping();

      expect(captured).toEqual([
        { method: 'flushDb', args: [] },
        { method: 'ping', args: [] },
      ]);
    });

    it('namespaces the duplicated pub/sub clients too', async () => {
      const { redisPub, redisSub } = await loadClient('nextjs');

      await redisPub.publish('jobs', 'payload');
      await redisSub.subscribe('jobs', vi.fn());

      expect(captured.map((c) => c.args[0])).toEqual([
        'nextjs:jobs',
        'nextjs:jobs',
      ]);
    });
  });

  describe('with an empty namespace (tests / unset)', () => {
    it('leaves keys raw with no leading colon', async () => {
      const { redis } = await loadClient(undefined);

      await redis.get('credits:user_1:pro');
      await redis.set('stripe:user:user_1', 'standard', { EXAT: 1234 });
      await redis.publish('jobs', 'payload');

      expect(captured).toEqual([
        { method: 'get', args: ['credits:user_1:pro'] },
        {
          method: 'set',
          args: ['stripe:user:user_1', 'standard', { EXAT: 1234 }],
        },
        { method: 'publish', args: ['jobs', 'payload'] },
      ]);
    });
  });
});
