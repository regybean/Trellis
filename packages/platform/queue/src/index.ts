import type { Processor, QueueOptions, WorkerOptions } from 'bullmq';
import { Queue, Worker } from 'bullmq';

import { logger } from '@acme/logger';
import { env as redisEnv } from '@acme/redis/env';

import { env } from './env';

// Re-exported so consumers (the sole processor home, @acme/chat) can type their
// processor as `Job<T>` without importing `bullmq` directly — @acme/queue is the
// only package that may depend on BullMQ (enforced by the boundary check).
export type { Job } from 'bullmq';

// BullMQ manages its own ioredis connections internally when given plain options,
// separate from @acme/redis's clients — but the connection string is sourced from
// @acme/redis's env home (`REDIS_URL` is authored config, ADR 0033), not a queue
// env row. maxRetriesPerRequest: null is required for Worker blocking commands to
// avoid ioredis timing them out.
const parseRedisUrl = (url: string) => {
  const { hostname, port, password, pathname, protocol } = new URL(url);
  return {
    host: hostname,
    port: Number(port) || 6379,
    ...(password && { password: decodeURIComponent(password) }),
    ...(pathname.length > 1 && { db: Number(pathname.slice(1)) }),
    ...(protocol === 'rediss:' && { tls: {} }),
    maxRetriesPerRequest: null,
  };
};

const connection = parseRedisUrl(redisEnv.REDIS_URL);

// Per-app BullMQ key prefix. Every app shares one Redis instance, so without a
// per-app prefix all four apps' workers would drain the same `bull:generation`
// list — a worker could process another app's job and then persist under the
// wrong Redis namespace / Postgres schema. NEXT_PUBLIC_WEBAPP is the same app
// identity @acme/redis uses for nsKey, so producer (chat.send) and consumer
// (app worker.ts) — both running under the app's env — resolve the same prefix.
const prefix = env.NEXT_PUBLIC_WEBAPP;

export const QUEUE_NAMES = {
  GENERATION: 'generation',
  INGEST: 'ingest',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const createQueue = <
  T = unknown,
  R = unknown,
  N extends string = string,
>(
  name: QueueName,
  options?: Omit<QueueOptions, 'connection'>,
) => {
  const queue = new Queue<T, R, N>(name, { ...options, connection, prefix });
  queue.on('error', (error) => {
    logger.error({ err: error, queue: name }, 'BullMQ queue error');
  });
  return queue;
};

export const createWorker = <
  T = unknown,
  R = unknown,
  N extends string = string,
>(
  name: QueueName,
  processor: Processor<T, R, N>,
  options?: Omit<WorkerOptions, 'connection'>,
) => {
  const worker = new Worker<T, R, N>(name, processor, {
    ...options,
    connection,
    prefix,
  });
  worker.on('error', (error) => {
    logger.error({ err: error, queue: name }, 'BullMQ worker error');
  });
  return worker;
};
