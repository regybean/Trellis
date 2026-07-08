import { createServer } from 'node:http';
import { createServerAdapter } from '@whatwg-node/server';

import { logger } from '@acme/logger';
import { createTRPCFetchHandler } from '@acme/trpc/handler';

import { isFeatureName, registry } from './registry';
import { resolveContext } from './trpc-context';

/**
 * Generic standalone tRPC host. Reads `FEATURE` (chat | ingest | feedback) and
 * `PORT`, dynamically imports the selected feature's `/server` seam, and mounts
 * its `appRouter` on a plain Node HTTP server behind a constant local principal
 * + unlimited entitlements (no Clerk, no billing). The showcase's "one feature
 * per process" microservice unit. Local / demo scope only.
 */

const feature = process.env.FEATURE;
const port = Number(process.env.PORT);

if (feature === undefined || !isFeatureName(feature)) {
  throw new Error(
    `FEATURE must be one of: ${Object.keys(registry).join(', ')} (got: ${String(feature)})`,
  );
}

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(
    `PORT must be a positive integer (got: ${String(process.env.PORT)})`,
  );
}

const entry = registry[feature];
const { appRouter, createTRPCContext } = await entry.import();

// The fetch handler wraps tRPC's fetch adapter with shared error logging + CORS
// (`@acme/trpc/handler`). The resolver injects the local principal. The same GET
// handler carries `httpSubscriptionLink` SSE (e.g. `chat.stream`).
const handler = createTRPCFetchHandler({
  endpoint: entry.endpoint,
  router: appRouter,
  createContext: createTRPCContext,
  resolver: resolveContext,
});

// `@whatwg-node/server`'s adapter is purpose-built to be handed straight to
// `node:http.createServer`; it owns the response promise internally, so the
// void-return mismatch the lint rule flags is a false positive here.
const adapter = createServerAdapter((request: Request) => handler(request));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
const server = createServer(adapter);

server.listen(port, () => {
  logger.info(
    { feature, port, endpoint: entry.endpoint },
    `service-host: mounted "${feature}" on port ${port} at ${entry.endpoint}`,
  );
});
