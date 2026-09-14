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
 * Provider selection, declared once. Provider choice, the embedding dimension,
 * and every provider's model ids / region / base URL are non-sensitive values
 * that differ per deploy target, so they are authored here as profile values;
 * the raw credentials are the keys with no profile value and are demanded by
 * `validateModelSecrets()` below, from the *selected* providers (value axis).
 *
 * The authored selection is development's, and both roles are **unauthored** on
 * a deploy target: development picks Ollama, whose `baseUrl` is a localhost
 * address, and a role is one whole JSON document, so the address cannot be
 * dropped while the rest is kept
 * ([@acme/env ADR 0003](../../../platform/env/docs/adr/0003-a-deploy-target-authors-its-own-profile.md)).
 * A deploy target states its own pair, dimensions included.
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
    withProfiles(shape, appEnv, {
      default: MODELS_DEVELOPMENT_PROFILE,
      // Both roles are the local Ollama provider, and its `baseUrl` is a
      // localhost address — a deploy that inherited it would resolve a model
      // against a port nothing is listening on. Authorship is per key and each
      // role is one whole JSON document, so the two unauthor together: there is
      // no way to keep the model id while dropping the address it lives at.
      //
      // A deploy target therefore states its own selection, and that includes
      // `MODELS_EMBED.dimensions` — the value `@acme/rag` reads to size the
      // pgvector column. Repointing embeddings at a model of a different width
      // is already a re-index rather than a restart
      // ([@acme/rag ADR 0002](../../rag/docs/adr/0002-knowledge-base-index-provisioned-at-boot.md)),
      // so it is right that a target says the width out loud.
      staging: { MODELS_CHAT: undefined, MODELS_EMBED: undefined },
      production: { MODELS_CHAT: undefined, MODELS_EMBED: undefined },
    }),
  runtimeEnv: {
    MODELS_CHAT: readEnv('MODELS_CHAT'),
    MODELS_EMBED: readEnv('MODELS_EMBED'),
  },
  emptyStringAsUndefined: true,
});

// Provider *secrets*, validated declaratively from the resolved selection
// (value axis). Called once, eagerly, in `resolve.ts` so a provider-active app
// fails fast at import on missing credentials instead of on the first request —
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
// Each group is its own `createEnv` call so it can be demanded conditionally,
// and each routes through `withProfiles` with no authored values: that is what
// makes every key here a secret and what relaxes them — and only them — on a
// run that cannot supply one. `skipValidation` is never passed, anywhere.

// AWS creds — required whenever Bedrock is the chat OR embed provider. Resolved
// via the standard AWS provider chain at call time; declared here only so a
// Bedrock-active app fails fast with a clear message.
//
// `@acme/ingest` declares this same pair for S3, where development authors the
// LocalStack dummies. One variable, one value per process: the two agree on
// staging/production (both unauthored), and can only diverge in development with
// Bedrock selected.
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
