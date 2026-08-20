import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

/**
 * Models config-as-code (ADR 0026). Provider selection, the embedding dimension,
 * and every provider's model ids / region / base URL are non-sensitive tunables
 * that differ per deploy target — they live here, not in `process.env`. The raw
 * credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `OPENROUTER_API_KEY`)
 * stay in `env.ts` (`modelsEnv`), validated from this config's selected providers.
 *
 * `chat` and `embed` are **per-role discriminated unions** keyed by `provider`:
 * selecting a provider requires (and validates) only that provider's fields — on
 * Ollama there is no Bedrock `region`, on Bedrock no Ollama `baseUrl`. OpenRouter
 * is absent from the `embed` union (it exposes no embeddings API), so a no-embed
 * selection is structurally unrepresentable rather than a runtime `throw` in the
 * resolver.
 *
 * This module imports only zod + `@acme/config` — never the ai-sdk provider
 * factories — so consumers that need a value here (e.g. `@acme/rag`'s
 * `documents-schema` reading `embed.dimensions`) can build it without triggering
 * provider resolution, exactly as `@acme/models/env` allowed before.
 */

// Shared connection params, single-authored and spread into each variant below:
// the Ollama base URL and the Bedrock region each recur across the `chat` and
// `embed` roles, so they are declared once here rather than duplicated per role.
const ollamaConnection = { baseUrl: z.url() };
const bedrockConnection = { region: z.string().nonempty() };

// Per-variant leaf schemas reused across providers/roles.
const model = z.string().nonempty();
// Optional cheaper model for thread-title generation; the factory falls back to
// the chat model when unset.
const titleModel = z.string().optional();
// Vector dimension of the embed model — single source of truth for the PgVector
// index and the Drizzle mirror (`@acme/rag`).
const dimensions = z.coerce.number().int().positive();

// Chat (LLM) provider. Bedrock resolves credentials via the AWS chain; OpenRouter
// carries no connection param (only its API-key secret, validated in env.ts).
export const chatConfigSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('ollama'),
    ...ollamaConnection,
    model,
    titleModel,
  }),
  z.object({
    provider: z.literal('bedrock'),
    ...bedrockConnection,
    model,
    titleModel,
  }),
  z.object({ provider: z.literal('openrouter'), model, titleModel }),
]);

// Embed provider. OpenRouter is deliberately absent — it exposes no embeddings
// API — so an OpenRouter embed selection fails at parse time.
export const embedConfigSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('ollama'),
    ...ollamaConnection,
    model,
    dimensions,
  }),
  z.object({
    provider: z.literal('bedrock'),
    ...bedrockConnection,
    model,
    dimensions,
  }),
]);

// The narrowed variant a resolver/factory receives — the whole union, or one
// provider's slice of it via the discriminant.
export type ChatConfig = z.output<typeof chatConfigSchema>;
export type EmbedConfig = z.output<typeof embedConfigSchema>;
export type OllamaChatConfig = Extract<ChatConfig, { provider: 'ollama' }>;
export type BedrockChatConfig = Extract<ChatConfig, { provider: 'bedrock' }>;
export type OpenRouterChatConfig = Extract<
  ChatConfig,
  { provider: 'openrouter' }
>;
export type OllamaEmbedConfig = Extract<EmbedConfig, { provider: 'ollama' }>;
export type BedrockEmbedConfig = Extract<EmbedConfig, { provider: 'bedrock' }>;

export function modelsConfig(context: ConfigContext) {
  return createConfig({
    server: {
      chat: chatConfigSchema,
      embed: embedConfigSchema,
    },
    profiles: {
      // Ollama is the dev/test default (ADR 0026): tiny CPU-only models over the
      // OpenAI-compatible `/v1` endpoint. Flipping a role to Bedrock/OpenRouter
      // for a deploy target is a staging/production overlay supplying that
      // provider's variant — the discriminated union then strips the Ollama-only
      // `baseUrl` on merge (zod object-strip).
      default: {
        server: {
          chat: {
            provider: 'ollama',
            baseUrl: 'http://localhost:11434/v1',
            model: 'qwen2.5:1.5b',
          },
          embed: {
            provider: 'ollama',
            baseUrl: 'http://localhost:11434/v1',
            model: 'nomic-embed-text',
            dimensions: 768,
          },
        },
      },
    },
    context,
  });
}
