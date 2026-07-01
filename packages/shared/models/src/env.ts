import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

// Validation is skipped on CI and during lint so those steps don't need a real
// provider configured — matches the convention in the other `env.ts` files.
const skipValidation =
  !!process.env.CI ||
  process.env.npm_lifecycle_event === 'lint' ||
  process.env.NEXT_PHASE === 'phase-production-build';

// Provider selection + the one cross-provider knob (embedding dimension). These
// are always required; the per-provider envs below are only validated when their
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
