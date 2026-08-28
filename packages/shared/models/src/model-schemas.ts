import { z } from 'zod/v4';

/**
 * The provider-selection schemas `env.ts` validates `MODELS_CHAT` and
 * `MODELS_EMBED` against, and the narrowed variant types each factory receives.
 *
 * Kept beside `env.ts` rather than inside it so the env module stays what it is —
 * one `createEnv` call — while the schemas and the six UI-facing types live in a
 * plain module. Imports only zod, so a consumer that needs a value from the
 * resolved env (e.g. `@acme/rag`'s `documents-schema` reading
 * `MODELS_EMBED.dimensions`) never triggers provider resolution.
 *
 * `chat` and `embed` are **per-role discriminated unions** keyed by `provider`:
 * selecting a provider requires (and validates) only that provider's fields — on
 * Ollama there is no Bedrock `region`, on Bedrock no Ollama `baseUrl`. OpenRouter
 * is absent from the `embed` union (it exposes no embeddings API), so a no-embed
 * selection is structurally unrepresentable rather than a runtime `throw` in the
 * resolver.
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
