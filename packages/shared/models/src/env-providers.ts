import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { shouldSkipEnvValidation } from '@acme/env';

// Per-provider env schemas — INTERNAL to `@acme/models`. These carry raw
// provider credentials (AWS keys, the OpenRouter API key, the Ollama base URL)
// and must never leak past the seam: only the provider factories in
// `bedrock.ts` / `openrouter.ts` / `ollama.ts` consume them, and only the one
// selected provider's factory ever runs (see `resolve.ts`). The public env
// surface is `modelsEnv()` in `env.ts` (the `@acme/models/env` subpath); these
// factories are deliberately not re-exported there.
//
// Whether to skip schema validation is decided centrally by `@acme/env` (lint
// and the Next build skip; tests always validate + coerce; non-test CI skips).
const skipValidation = shouldSkipEnvValidation();

// AWS Bedrock. Credentials resolve via the standard AWS provider chain
// (env vars / SSO / instance role); they are declared here so a Bedrock-active
// app fails fast with a clear message instead of an opaque AWS error.
export function bedrockEnv() {
  return createEnv({
    server: {
      AWS_REGION: z.string().nonempty().default('eu-west-2'),
      BEDROCK_CHAT_MODEL: z.string().nonempty(),
      // Optional cheaper model for thread-title generation; falls back to the
      // chat model when unset.
      BEDROCK_TITLE_MODEL: z.string().optional(),
      BEDROCK_EMBED_MODEL: z.string().nonempty(),
      AWS_ACCESS_KEY_ID: z.string(),
      AWS_SECRET_ACCESS_KEY: z.string(),
    },
    client: {},
    runtimeEnv: {
      AWS_REGION: process.env.AWS_REGION,
      BEDROCK_CHAT_MODEL: process.env.BEDROCK_CHAT_MODEL,
      BEDROCK_TITLE_MODEL: process.env.BEDROCK_TITLE_MODEL,
      BEDROCK_EMBED_MODEL: process.env.BEDROCK_EMBED_MODEL,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    },
    skipValidation,
  });
}

// OpenRouter (chat only). The API key is a real secret and must be non-empty.
export function openrouterEnv() {
  return createEnv({
    server: {
      OPENROUTER_API_KEY: z.string().nonempty(),
      OPENROUTER_CHAT_MODEL: z.string().nonempty(),
      // Optional cheaper model for thread-title generation; falls back to the
      // chat model when unset.
      OPENROUTER_TITLE_MODEL: z.string().optional(),
    },
    client: {},
    runtimeEnv: {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      OPENROUTER_CHAT_MODEL: process.env.OPENROUTER_CHAT_MODEL,
      OPENROUTER_TITLE_MODEL: process.env.OPENROUTER_TITLE_MODEL,
    },
    skipValidation,
  });
}

// Ollama, reached over its OpenAI-compatible `/v1` endpoint (chat + embeddings).
export function ollamaEnv() {
  return createEnv({
    server: {
      OLLAMA_BASE_URL: z.url(),
      OLLAMA_CHAT_MODEL: z.string().nonempty(),
      // Optional cheaper model for thread-title generation; falls back to the
      // chat model when unset.
      OLLAMA_TITLE_MODEL: z.string().optional(),
      OLLAMA_EMBED_MODEL: z.string().nonempty(),
    },
    client: {},
    runtimeEnv: {
      OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
      OLLAMA_CHAT_MODEL: process.env.OLLAMA_CHAT_MODEL,
      OLLAMA_TITLE_MODEL: process.env.OLLAMA_TITLE_MODEL,
      OLLAMA_EMBED_MODEL: process.env.OLLAMA_EMBED_MODEL,
    },
    skipValidation,
  });
}
