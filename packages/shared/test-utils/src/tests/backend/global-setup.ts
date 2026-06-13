/**
 * Global setup for the secrets-backend test.
 *
 * Brings up LocalStack the same way the shared DB/Redis setup brings up its
 * infra: a testcontainer in CI, an assumed `pnpm infra:up` service locally.
 * Only LocalStack is started here — this test needs no Postgres/Redis.
 */

/* eslint-disable no-restricted-syntax */

import net from 'node:net';

import 'vitest';

import type { TestProject } from 'vitest/node';

import {
  getLocalstackUrl,
  startLocalstackContainer,
  stopLocalstackContainer,
} from '../../containers';

declare module 'vitest' {
  export interface ProvidedContext {
    AWS_ENDPOINT_URL: string;
  }
}

async function isPortOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

export async function setup(project: TestProject) {
  let startedContainer = false;
  let endpoint: string;

  if (process.env.CI === 'true') {
    await startLocalstackContainer();
    endpoint = getLocalstackUrl();
    startedContainer = true;
  } else {
    const running = await isPortOpen(4566);
    if (!running) {
      throw new Error(
        'LocalStack is not running on port 4566. Start it with `pnpm infra:up`.',
      );
    }
    endpoint = 'http://localhost:4566';
  }

  console.log(`🟣 LocalStack endpoint for secrets test: ${endpoint}`);
  project.provide('AWS_ENDPOINT_URL', endpoint);

  return async () => {
    if (startedContainer) {
      await stopLocalstackContainer();
    }
  };
}

export default setup;
