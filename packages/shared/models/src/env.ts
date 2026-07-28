import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { resolveAppEnv } from '@acme/config';
import { shouldSkipEnvValidation } from '@acme/env';

import type { ChatConfig, EmbedConfig } from './config';

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this slice's
 * sanctioned `process.env` edge and threaded into `modelsConfig` where the slice
 * builds its config server-side (`resolve.ts`). Mirrors the app's `env.ts`; keeps
 * `config.ts` pure.
 *
 * `@acme/models` has no non-secret env left: provider selection, model ids,
 * region and base URL are all config-as-code now (`config.ts`). The raw
 * credentials are validated by `modelsEnv`, whose required set is derived from
 * the resolved config (value axis, ADR 0026).
 */
export const appEnv = resolveAppEnv(process.env.APP_ENV);

// Provider *secrets*, validated declaratively from the resolved config (ADR 0026,
// value axis). Called once, eagerly, in `resolve.ts` so a provider-active app
// fails fast at import on missing credentials instead of on the first request —
// exactly which secrets are required is a function of the config-selected
// providers, never a permissive `.optional()`:
//
//   - OpenRouter chat            → `OPENROUTER_API_KEY`
//   - Bedrock chat OR embed      → the AWS creds (resolved via the AWS chain)
//   - Ollama (dev/test default)  → no secret
//
// This is *validation-only*: the provider SDKs keep reading these implicitly
// (Bedrock via the AWS provider chain; OpenRouter via `process.env.OPENROUTER_API_KEY`
// inside `createOpenRouter`) — the values are never threaded back into the
// factories.
const skipValidation = shouldSkipEnvValidation();

// AWS creds — required whenever Bedrock is the chat OR embed provider. Resolved
// via the standard AWS provider chain at call time; declared here only so a
// Bedrock-active app fails fast with a clear message.
function awsSecretEnv() {
  return createEnv({
    server: {
      AWS_ACCESS_KEY_ID: z.string().nonempty(),
      AWS_SECRET_ACCESS_KEY: z.string().nonempty(),
    },
    client: {},
    runtimeEnv: {
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    },
    skipValidation,
  });
}

// OpenRouter API key — required only when OpenRouter is the chat provider (it has
// no embeddings API, so it never appears on the embed axis).
function openrouterSecretEnv() {
  return createEnv({
    server: { OPENROUTER_API_KEY: z.string().nonempty() },
    client: {},
    runtimeEnv: { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY },
    skipValidation,
  });
}

// The single secret-validation entry point: the required set is *derived from the
// resolved config* (value axis) — each group's `server` shape + `runtimeEnv` are
// authored together in the helper above so they can't drift, and only the active
// providers' groups run. Ollama (the dev/test default) matches neither branch, so
// it validates nothing.
export function modelsEnv(config: { chat: ChatConfig; embed: EmbedConfig }) {
  if (
    config.chat.provider === 'bedrock' ||
    config.embed.provider === 'bedrock'
  ) {
    awsSecretEnv();
  }
  if (config.chat.provider === 'openrouter') {
    openrouterSecretEnv();
  }
}
