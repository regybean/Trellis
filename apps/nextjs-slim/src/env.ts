import { createEnv } from '@t3-oss/env-nextjs';

import { chatEnv } from '@acme/chat/env';
import { ingestEnv } from '@acme/ingest/env';

const skipValidation =
  !!process.env.CI ||
  process.env.npm_lifecycle_event === 'lint' ||
  process.env.NEXT_PHASE === 'phase-production-build';

export const env = createEnv({
  extends: [chatEnv(), ingestEnv()],
  server: {},
  client: {},
  runtimeEnv: {},
  skipValidation,
});
