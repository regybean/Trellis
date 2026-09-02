# Mounting `@acme/models`

An app mounts this by **importing it at boot**. That is the whole mounting: the
import resolves the selected chat and embed providers and validates the secrets
those providers imply, so a misconfigured deploy crashes at startup instead of on
the first request.

Feature packages call `chatModel` / `embedModel`; the app only forces the
resolution to happen early.

## Mounted by

All four apps, at the same server boundary they init telemetry from:

- `apps/nextjs` / `apps/nextjs-slim` — `src/instrumentation.ts`
- `apps/tanstack-start` / `apps/tanstack-slim` — `src/nitro/telemetry.ts`

## Glue

### Boot-time resolution — `apps/nextjs/src/instrumentation.ts`

```ts
// Resolve active chat+embed providers at boot so a missing/invalid env for a
// *selected* provider crashes startup, not the first request. Only the chosen
// providers' envs are validated (resolve.ts switch) — ollama stays AWS-free.
await import('@acme/models');
```

TanStack Start — `apps/tanstack-start/src/nitro/telemetry.ts`:

```ts
// Boot-time parity with apps/nextjs's instrumentation.ts: resolve the active
// chat+embed providers so a missing/invalid env for a *selected* provider
// crashes startup, not the first request.
await import('@acme/models');
```

A dynamic import with no binding looks like dead code and is not: the module's
side effect is the point. Delete it and the app still works until the first
request hits a provider whose credentials were never set.

### What a feature imports

```ts
import {
  chatModel,
  embedModel,
  embedProviderOptions,
  titleModel,
} from '@acme/models';
```

Four exports, all resolved from the selection below. Swapping provider is an env
change, not a code change — which is the seam this package exists to keep
(ADR 0003).

## Env

Factory: `src/env.ts`, exported as `@acme/models/env`.

**Selection** (both `shared`, so browser-safe; both go through `jsonEnv` and are
overridden as one whole JSON document):

| Key            | Kind   | Authored development value                                                                                 |
| -------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `MODELS_CHAT`  | config | `{ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:1.5b' }`                      |
| `MODELS_EMBED` | config | `{ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'nomic-embed-text', dimensions: 768 }` |

```bash
# whole-value override — the union exists so a half-configured provider cannot
# be represented, and per-field override would hand that failure back
MODELS_CHAT='{"provider":"openrouter","model":"…"}'
```

**Secrets**, demanded conditionally by `validateModelSecrets()` from the
_resolved_ selection:

| Selection                     | Required secrets                             |
| ----------------------------- | -------------------------------------------- |
| Bedrock on chat **or** embed  | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| OpenRouter on chat            | `OPENROUTER_API_KEY`                         |
| Ollama (the dev/test default) | none                                         |

Validation only — the provider SDKs keep reading these implicitly (Bedrock via
the AWS provider chain, OpenRouter via `process.env` inside `createOpenRouter`).

Note the shared-key hazard: `@acme/ingest` declares the same AWS pair for S3,
where development authors the LocalStack dummies. One variable, one value per
process — the two agree on staging/production (both unauthored) and can only
diverge in development with Bedrock selected.

`MODELS_EMBED.dimensions` is read at module load by `@acme/rag`'s
`documents-schema`, which the app's drizzle-kit schema barrel imports. That is
why the selection keys are `shared` rather than `server`.

## Infra

No `acme.infra` of its own — but this slice is what **decides** whether the
`ollama` container starts. `scripts/resolve-infra.ts` reads
`src/development-profile.ts` (not `env.ts`, so it sees authored values and never
an operator's override) and drops the `ollama` compose profile unless the chat or
embed role selects it. `scripts/resolve-compose-env.ts` derives the port and the
model ids to pull from the same file.

So: mount this with the default profile and `pnpm infra:up` starts `ollama`
(`deploy/compose.yaml`, published on `${OLLAMA_PORT}` → 11434, pulling both
authored models on first boot). Select Bedrock or OpenRouter and the container
disappears from the stack with no compose edit.

## Also mount

`@acme/env`. Nothing else from `@acme/*` — the provider SDKs (`ai`,
`@ai-sdk/amazon-bedrock`, `@openrouter/ai-sdk-provider`,
`@ai-sdk/openai-compatible`) are this package's own dependencies, so an app never
imports them.
