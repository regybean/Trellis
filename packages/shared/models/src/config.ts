import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

/**
 * Models config-as-code (ADR 0026). Provider selection, the embedding dimension,
 * and every provider's model ids / region / base URL are non-sensitive tunables
 * that differ per deploy target — they move here out of `process.env`. The raw
 * credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `OPENROUTER_API_KEY`)
 * stay in `env-providers.ts`, validated lazily by the selected provider's factory.
 *
 * This module imports only zod + `@acme/config` — never the ai-sdk provider
 * factories — so consumers that need a value here (e.g. `@acme/rag`'s
 * `documents-schema` reading `EMBED_DIMENSIONS`) can build it without triggering
 * provider resolution, exactly as `@acme/models/env` allowed before.
 *
 * All keys carry a base (development) default, so validating the full shape
 * eagerly is safe for every provider — selecting a provider still only validates
 * *its* secrets (those remain in the per-provider env factories).
 */
export function modelsConfig(context: ConfigContext) {
  return createConfig({
    server: {
      // Provider selection. OpenRouter has no embeddings API, so it is excluded
      // from EMBED_PROVIDER — selecting it fails with a clear enum error.
      LLM_PROVIDER: z.enum(['bedrock', 'openrouter', 'ollama']),
      EMBED_PROVIDER: z.enum(['bedrock', 'ollama']),
      // Vector dimension of the embed model — the single source of truth for the
      // PgVector index and the Drizzle mirror (`@acme/rag`).
      EMBED_DIMENSIONS: z.number().int().positive(),
      // Bedrock — region + model ids (credentials resolve via the AWS chain).
      AWS_REGION: z.string().nonempty(),
      BEDROCK_CHAT_MODEL: z.string().nonempty(),
      // Optional cheaper model for thread-title generation; the factory falls
      // back to the chat model when unset.
      BEDROCK_TITLE_MODEL: z.string().optional(),
      BEDROCK_EMBED_MODEL: z.string().nonempty(),
      // OpenRouter (chat only).
      OPENROUTER_CHAT_MODEL: z.string().nonempty(),
      OPENROUTER_TITLE_MODEL: z.string().optional(),
      // Ollama, over its OpenAI-compatible `/v1` endpoint (chat + embeddings).
      OLLAMA_BASE_URL: z.url(),
      OLLAMA_CHAT_MODEL: z.string().nonempty(),
      OLLAMA_TITLE_MODEL: z.string().optional(),
      OLLAMA_EMBED_MODEL: z.string().nonempty(),
    },
    profiles: {
      default: {
        server: {
          LLM_PROVIDER: 'ollama',
          EMBED_PROVIDER: 'ollama',
          EMBED_DIMENSIONS: 768,
          AWS_REGION: 'eu-west-2',
          BEDROCK_CHAT_MODEL: 'eu.anthropic.claude-3-7-sonnet-20250219-v1:0',
          BEDROCK_EMBED_MODEL: 'cohere.embed-english-v3',
          // Opt-in provider; a sensible default so selecting it works out of the
          // box (previously an empty `.env` row you had to fill in).
          OPENROUTER_CHAT_MODEL: 'openai/gpt-4o-mini',
          OLLAMA_BASE_URL: 'http://localhost:11434/v1',
          OLLAMA_CHAT_MODEL: 'qwen2.5:1.5b',
          OLLAMA_EMBED_MODEL: 'nomic-embed-text',
        },
      },
    },
    context,
  });
}
