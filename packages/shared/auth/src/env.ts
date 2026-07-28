import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { shouldSkipEnvValidation } from '@acme/env';

// Clerk secret — INTERNAL to `@acme/auth`, co-declared next to `config.ts` so the
// slice's secret can't drift from its config (ADR 0026, composition axis). Only
// the two *full* apps compose this (`apps/{nextjs,tanstack-start}/src/env.ts`);
// the `*-slim` apps mount no auth, so they never demand it (ADR 0010).
//
// This is *validation-only*: the Clerk SDK (`clerkClient()`/`auth()`/
// `clerkMiddleware()`) keeps reading `CLERK_SECRET_KEY` implicitly from
// `process.env` — the key is never passed to Clerk here (passing `secretKey` to
// middleware would flip Clerk into Dynamic Keys mode, #94). Declaring it forces a
// full app to fail fast at boot on a missing key instead of on the first Clerk
// call with an opaque error. Exact `bedrockEnv()` precedent.
//
// Whether to skip schema validation is decided centrally by `@acme/env` (lint and
// the Next build skip; tests always validate; non-test CI skips).
const skipValidation = shouldSkipEnvValidation();

export function authEnv() {
  return createEnv({
    server: {
      CLERK_SECRET_KEY: z.string().nonempty(),
    },
    client: {},
    runtimeEnv: {
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    },
    skipValidation,
  });
}
