import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { shouldSkipEnvValidation } from '@acme/env';

// Per-provider *secret* schemas — INTERNAL to `@acme/models`. These carry raw
// provider credentials (AWS keys, the OpenRouter API key) and must never leak
// past the seam: only the provider factories in `bedrock.ts` / `openrouter.ts`
// consume them, and only the one selected provider's factory ever runs (see
// `resolve.ts`). The non-secret model ids / region / base URL that used to live
// here are config-as-code now (`config.ts`, ADR 0026); Ollama has no secret, so
// it no longer needs an env factory at all.
//
// Whether to skip schema validation is decided centrally by `@acme/env` (lint
// and the Next build skip; tests always validate + coerce; non-test CI skips).
const skipValidation = shouldSkipEnvValidation();

// AWS Bedrock. Credentials resolve via the standard AWS provider chain
// (env vars / SSO / instance role); they are declared here so a Bedrock-active
// app fails fast with a clear message instead of an opaque AWS error. The region
// and model ids are config (`config.ts`).
export function bedrockEnv() {
  return createEnv({
    server: {
      AWS_ACCESS_KEY_ID: z.string(),
      AWS_SECRET_ACCESS_KEY: z.string(),
    },
    client: {},
    runtimeEnv: {
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    },
    skipValidation,
  });
}

// OpenRouter (chat only). The API key is a real secret and must be non-empty;
// the model ids are config (`config.ts`).
export function openrouterEnv() {
  return createEnv({
    server: {
      OPENROUTER_API_KEY: z.string().nonempty(),
    },
    client: {},
    runtimeEnv: {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    },
    skipValidation,
  });
}
