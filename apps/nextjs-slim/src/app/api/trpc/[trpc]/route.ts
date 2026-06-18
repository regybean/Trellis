import { logger } from '@acme/logger';

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

const handler = (_req: Request) => {
  logger.warn({
    message:
      'Unidentified tRPC path. You must call a procedure path like /api/trpc/<nameofrouter>/<procedure> (or use the tRPC client within the package).',
    hint: 'If you expected tRPC to work here, ensure you have src/app/api/trpc/<name> (from package -> react.tsx -> api/trpc/<name>)/[trpc]/route.ts definition from the package you import.',
  });
  const response = Response.json({
    status: 404,
  });

  setCorsHeaders(response);
  return response;
};
export { handler as GET, handler as POST };
