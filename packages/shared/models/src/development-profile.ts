/**
 * The authored **development** provider selection, in a module that executes no
 * `createEnv` call.
 *
 * `env.ts` authors its `default` profile from this object, and two provisioning
 * paths read it *without* an environment: `scripts/resolve-compose-env.ts`
 * derives the local Ollama port and the models to pull, and
 * `scripts/resolve-infra.ts` decides whether the `ollama` compose profile is
 * needed at all. Both provision the local stack, so they want the authored
 * values rather than an operator's override.
 *
 * Ollama is the dev/test default: tiny CPU-only models over the
 * OpenAI-compatible `/v1` endpoint. That `baseUrl` is a localhost address, so
 * `env.ts` unauthors both roles on staging and production rather than letting a
 * deploy inherit it — a deploy target supplies its own `MODELS_CHAT` /
 * `MODELS_EMBED`, and the discriminated union strips the Ollama-only `baseUrl`
 * on parse (zod object-strip) when that provider is Bedrock or OpenRouter.
 */
export const MODELS_DEVELOPMENT_PROFILE = {
  MODELS_CHAT: {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:1.5b',
  },
  MODELS_EMBED: {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'nomic-embed-text',
    dimensions: 768,
  },
} as const;
