import type { Processor, QueueOptions, WorkerOptions } from 'bullmq';
import { Queue, Worker } from 'bullmq';

import { logger } from '@acme/logger';

import { env } from './env';

// Re-exported so consumers (the sole processor home, @acme/chat) can type their
// processor as `Job<T>` without importing `bullmq` directly — @acme/queue is the
// only package that may depend on BullMQ (enforced by the boundary check).
export type { Job } from 'bullmq';

// BullMQ manages its own ioredis connections internally when given plain options —
// separate from @acme/redis. maxRetriesPerRequest: null is required for Worker
// blocking commands to avoid ioredis timing them out.
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

const connection = parseRedisUrl(env.REDIS_URL);

export const QUEUE_NAMES = {
  GENERATION: 'generation',
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
  const queue = new Queue<T, R, N>(name, { ...options, connection });
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
  });
  worker.on('error', (error) => {
    logger.error({ err: error, queue: name }, 'BullMQ worker error');
  });
  return worker;
};
