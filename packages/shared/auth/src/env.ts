import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { shouldSkipEnvValidation } from '@acme/env';

// Auth secrets — INTERNAL to `@acme/auth`, co-declared next to `config.ts` so the
// slice's secrets can't drift from its config (ADR 0026, composition axis). Only
// the two *full* apps compose this (`apps/{nextjs,tanstack-start}/src/env.ts`);
// the `*-slim` apps mount no auth, so they never demand it (ADR 0010).
//
// `@t3-oss/env-core`, not `env-nextjs`: this is a shared-layer package, and the
// Next-flavoured entry was a framework dependency in a layer that is not allowed
// one (boundaries: shared → platform → tooling). There is nothing Next-specific
// to lose — the schema declares no `NEXT_PUBLIC_*` client vars, which is the only
// thing the Next flavour adds. The composing app still uses `env-nextjs` and
// pulls this in through `extends`.
//
// Whether to skip schema validation is decided centrally by `@acme/env` (lint and
// the Next build skip; tests always validate; non-test CI skips).
const skipValidation = shouldSkipEnvValidation();

export function authEnv() {
  return createEnv({
    server: {
      // Signs session cookies and encrypts stored tokens. Better Auth would
      // otherwise fall back to reading `BETTER_AUTH_SECRET` off `process.env`
      // itself — and silently use a hardcoded development default when unset.
      // Declaring it makes a full app fail fast at boot instead. Generate with
      // `openssl rand -base64 32`.
      BETTER_AUTH_SECRET: z.string().nonempty(),
      // Clerk secret. Clerk is still the live auth provider (#218 migrates the
      // apps); this row goes when it does.
      //
      // This is *validation-only*: the Clerk SDK (`clerkClient()`/`auth()`/
      // `clerkMiddleware()`) keeps reading `CLERK_SECRET_KEY` implicitly from
      // `process.env` — the key is never passed to Clerk here (passing
      // `secretKey` to middleware would flip Clerk into Dynamic Keys mode, #94).
      // Declaring it forces a full app to fail fast at boot on a missing key
      // instead of on the first Clerk call with an opaque error.
      CLERK_SECRET_KEY: z.string().nonempty(),
    },
    runtimeEnv: {
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    },
    skipValidation,
  });
}
