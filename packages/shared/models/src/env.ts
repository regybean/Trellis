import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { shouldSkipEnvValidation } from '@acme/env';

// Public env surface of `@acme/models` (the `@acme/models/env` subpath). Only
// `modelsEnv()` is exported here: provider selection plus the one cross-provider
// knob (embedding dimension). The per-provider env schemas — which carry raw
// AWS/OpenRouter/Ollama credentials — are internal to the package
// (`env-providers.ts`) and consumed only by the provider factories, so those
// secrets never leak through the seam.
//
// Whether to skip schema validation is decided centrally by `@acme/env` (lint
// and the Next build skip; tests always validate + coerce; non-test CI skips).
const skipValidation = shouldSkipEnvValidation();

// Provider selection + the one cross-provider knob (embedding dimension). These
// are always required; the per-provider envs are only validated when their
// provider is the one actually selected (see the lazy factories in resolve.ts).
export function modelsEnv() {
  return createEnv({
    server: {
      // LLM (chat) provider. Any of the three.
      LLM_PROVIDER: z
        .enum(['bedrock', 'openrouter', 'ollama'])
        .default('ollama'),
      // Embedding provider. OpenRouter has no embeddings API, so it is excluded
      // here — selecting it fails at parse time with a clear enum error.
      EMBED_PROVIDER: z.enum(['bedrock', 'ollama']).default('ollama'),
      // Vector dimension of the embed model. Not baked in: it is the single
      // source of truth for both the PgVector index and the Drizzle mirror, so
      // switching embed model means changing this and re-pushing the schema.
      EMBED_DIMENSIONS: z.coerce.number().int().positive(),
    },
    client: {},
    runtimeEnv: {
      LLM_PROVIDER: process.env.LLM_PROVIDER,
      EMBED_PROVIDER: process.env.EMBED_PROVIDER,
      EMBED_DIMENSIONS: process.env.EMBED_DIMENSIONS,
    },
    skipValidation,
  });
}
