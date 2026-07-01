import { NextResponse } from 'next/server';

import { logger } from '@acme/logger';

export const dynamic = 'force-dynamic';

export function GET() {
  const timestamp = new Date().toISOString();

  try {
    const response = {
      status: 'ok',
      timestamp,
      service: 'trellis-nextjs',
      pid: process.pid,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const errorResponse = {
      status: 'error',
      timestamp,
      service: 'trellis-nextjs',
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    logger.error(`Health check failed ${JSON.stringify(errorResponse)}`);

    return NextResponse.json(errorResponse, { status: 500 });
  }
}
