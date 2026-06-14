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

export const redis = createClient(redisOptions);
export const redisPub = redis.duplicate();
export const redisSub = redis.duplicate();

const attachErrorHandler = (label: string, client: typeof redis) => {
  client.on('error', (error) => {
    logger.error({ err: error, label }, 'Redis client error');
  });
};

attachErrorHandler('redis', redis);
attachErrorHandler('redisPub', redisPub);
attachErrorHandler('redisSub', redisSub);

// We do this because next build tries to connect when importing this file
// eslint-disable-next-line no-restricted-properties
if (process.env.IS_NEXT_BUILD !== 'true') {
  void redis.connect().catch((error) => {
    logger.error({ err: error }, 'Failed to connect to Redis');
  });
  void redisPub.connect().catch((error) => {
    logger.error({ err: error }, 'Failed to connect to Redis');
  });
  void redisSub.connect().catch((error) => {
    logger.error({ err: error }, 'Failed to connect to Redis');
  });
}
