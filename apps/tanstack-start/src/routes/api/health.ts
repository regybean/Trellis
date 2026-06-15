import { createFileRoute } from '@tanstack/react-router';

import { logger } from '@acme/logger';

const handler = () => {
  const timestamp = new Date().toISOString();

  try {
    return Response.json(
      {
        status: 'ok',
        timestamp,
        service: 'trellis-tanstack',
        pid: process.pid,
      },
      { status: 200 },
    );
  } catch (error) {
    const errorResponse = {
      status: 'error',
      timestamp,
      service: 'trellis-tanstack',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    logger.error(`Health check failed ${JSON.stringify(errorResponse)}`);
    return Response.json(errorResponse, { status: 500 });
  }
};

export const Route = createFileRoute('/api/health')({
  server: { handlers: { GET: () => handler() } },
});
