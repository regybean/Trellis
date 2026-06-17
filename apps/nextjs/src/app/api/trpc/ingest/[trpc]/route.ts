import type { NextRequest } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { appRouter, createTRPCContext } from '@acme/ingest/server';
import { subscriptionsEntitlements } from '@acme/subscriptions';
import { logTRPCError } from '@acme/trpc/error';

const setCorsHeaders = (res: Response) => {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Request-Method', '*');
  res.headers.set('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
  res.headers.set('Access-Control-Allow-Headers', '*');
};

export const OPTIONS = () => {
  const response = new Response(null, { status: 204 });
  setCorsHeaders(response);
  return response;
};

const createContext = async (req: NextRequest) => {
  // App-owned auth seam: resolve Clerk here and inject into the neutral context.
  return createTRPCContext({
    headers: req.headers,
    req,
    auth: await auth(),
    user: await currentUser(),
    entitlements: subscriptionsEntitlements,
  });
};

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: '/api/trpc/ingest',
    req,
    router: appRouter,
    createContext: () => createContext(req),
    onError: logTRPCError,
  });

export { handler as GET, handler as POST };
