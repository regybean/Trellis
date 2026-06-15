import type { NextRequest } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { appRouter, createTRPCContext } from '@acme/chat/server';
import { logTRPCError } from '@acme/trpc/error';

/**
 * Configure basic CORS headers
 * You should extend this to match your needs
 */
const setCorsHeaders = (res: Response) => {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Request-Method', '*');
  res.headers.set('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
  res.headers.set('Access-Control-Allow-Headers', '*');
};

export const OPTIONS = () => {
  const response = new Response(null, {
    status: 204,
  });
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
  });
};

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: '/api/trpc/chat',
    req,
    router: appRouter,
    createContext: () => createContext(req),
    onError: logTRPCError,
  });

export { handler as GET, handler as POST };
