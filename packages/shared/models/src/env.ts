import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import {
  jsonEnv,
  readEnv,
  resolveAppEnv,
  secretsOnly,
  withProfiles,
} from '@acme/env';

import { MODELS_DEVELOPMENT_PROFILE } from './development-profile';
import { chatConfigSchema, embedConfigSchema } from './model-schemas';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * Provider selection, declared once (@acme/env ADR 0001). Provider choice, the embedding
 * dimension, and every provider's model ids / region / base URL are non-sensitive
 * values that differ per deploy target, so they are authored here as profile
 * values; the raw credentials are the keys with no profile value and are demanded
 * by `validateModelSecrets()` below, from the *selected* providers (value axis).
 *
 * Both keys go through `jsonEnv`, so each is overridable as one JSON document —
 * `MODELS_CHAT='{"provider":"openrouter","model":"…"}'`. Whole-value override is
 * the point: the union exists so a half-configured provider cannot be
 * represented, and per-field override would hand that failure back.
 *
 * They are `shared` rather than `server` because they are browser-safe authored
 * values with no `NEXT_PUBLIC_` prefix to justify (t3-env requires the prefix on
 * `client` keys, and it would be a lie on a value never read from the
 * environment). That also keeps `@acme/rag`'s `documents-schema` — which reads
 * `MODELS_EMBED.dimensions` at module load and is imported by the app's schema
 * barrel and drizzle-kit — safe in every context.
 */
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {},
  shared: {
    MODELS_CHAT: jsonEnv(chatConfigSchema),
    MODELS_EMBED: jsonEnv(embedConfigSchema),
  },
  createFinalSchema: (shape) =>
    withProfiles(shape, appEnv, { default: MODELS_DEVELOPMENT_PROFILE }),
  runtimeEnv: {
    MODELS_CHAT: readEnv('MODELS_CHAT'),
    MODELS_EMBED: readEnv('MODELS_EMBED'),
  },
  emptyStringAsUndefined: true,
});

// Provider *secrets*, validated declaratively from the resolved selection (ADR
// 0033, value axis). Called once, eagerly, in `resolve.ts` so a provider-active
// app fails fast at import on missing credentials instead of on the first request —
// exactly which secrets are required is a function of the selected providers,
// never a permissive `.optional()`:
//
//   - OpenRouter chat            → `OPENROUTER_API_KEY`
//   - Bedrock chat OR embed      → the AWS creds (resolved via the AWS chain)
//   - Ollama (dev/test default)  → no secret
//
// This is *validation-only*: the provider SDKs keep reading these implicitly
// (Bedrock via the AWS provider chain; OpenRouter via `process.env.OPENROUTER_API_KEY`
// inside `createOpenRouter`) — the values are never threaded back into the
// factories.
//
// Each group is its own `createEnv` call so it can be demanded conditionally, and
// each routes through `withProfiles` with no authored values: that is what makes
// every key here a secret and what relaxes them — and only them — on a run that
// cannot supply one (@acme/env ADR 0001 §3). `skipValidation` is never passed, anywhere.

// AWS creds — required whenever Bedrock is the chat OR embed provider. Resolved
// via the standard AWS provider chain at call time; declared here only so a
// Bedrock-active app fails fast with a clear message.
//
// `@acme/ingest` declares this same pair for S3, where development authors the
// LocalStack dummies. One variable, one value per process: the two agree on
// staging/production (both unauthored), and can only diverge in development with
// Bedrock selected — see "When two slices declare the same key" in @acme/env's
// CONTEXT.md.
function awsSecretEnv() {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    server: {
      AWS_ACCESS_KEY_ID: z.string().nonempty(),
      AWS_SECRET_ACCESS_KEY: z.string().nonempty(),
    },
    createFinalSchema: secretsOnly(appEnv),
    runtimeEnv: {
      AWS_ACCESS_KEY_ID: readEnv('AWS_ACCESS_KEY_ID'),
      AWS_SECRET_ACCESS_KEY: readEnv('AWS_SECRET_ACCESS_KEY'),
    },
    emptyStringAsUndefined: true,
  });
}

// OpenRouter API key — required only when OpenRouter is the chat provider (it has
// no embeddings API, so it never appears on the embed axis).
function openrouterSecretEnv() {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    server: { OPENROUTER_API_KEY: z.string().nonempty() },
    createFinalSchema: secretsOnly(appEnv),
    runtimeEnv: { OPENROUTER_API_KEY: readEnv('OPENROUTER_API_KEY') },
    emptyStringAsUndefined: true,
  });
}

// The single secret-validation entry point: the required set is *derived from the
// resolved selection* (value axis) — each group's `server` shape + `runtimeEnv`
// are authored together in the helper above so they can't drift, and only the
// active providers' groups run. Ollama (the dev/test default) matches neither
// branch, so it validates nothing.
export function validateModelSecrets() {
  if (
    env.MODELS_CHAT.provider === 'bedrock' ||
    env.MODELS_EMBED.provider === 'bedrock'
  ) {
    awsSecretEnv();
  }
  if (env.MODELS_CHAT.provider === 'openrouter') {
    openrouterSecretEnv();
  }
}
