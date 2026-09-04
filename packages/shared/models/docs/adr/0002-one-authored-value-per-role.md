# One authored value per role, validated as a discriminated union

**Status:** accepted

> **Amends [ADR 0001](0001-multi-provider-models.md) on how a selection is
> expressed.** Three providers behind one package, one file each, chat and embed
> selected independently, and eager failure at import all stand. What changed is
> the shape of the selection — ADR 0001's `LLM_PROVIDER` / `EMBED_PROVIDER` enums
> and the loose `EMBED_DIMENSIONS` sibling are gone — and where a provider's
> secrets are demanded.

A role's selection is **one authored value**, validated against a discriminated
union keyed by `provider`: `MODELS_CHAT` (`ollama` | `bedrock` | `openrouter`)
and `MODELS_EMBED` (`ollama` | `bedrock`). Both are profile-authored config and
both go through `jsonEnv`, so each is overridable as a single JSON document
(`MODELS_CHAT='{"provider":"openrouter","model":"…"}'`). Five decisions are
load-bearing:

1. **The union is the contract, so override is whole-value.** Per-field override
   would hand back exactly the failure the union exists to prevent — a
   half-configured role, or a Bedrock `region` left stranded on an Ollama
   selection. Changing a role means supplying its variant entire.
2. **The invalid combination is unrepresentable rather than rejected at
   runtime.** OpenRouter is absent from the embed union because it exposes no
   embeddings API, so an OpenRouter embed selection fails when the env parses.
   `resolveEmbedModel` is total over the union and contains no `throw`.
3. **Shared connection params are single-authored and spread.** `baseUrl`
   (Ollama) and `region` (Bedrock) each recur across both roles, so each leaf
   schema is declared once in `model-schemas.ts` and spread into the variants
   that need it, rather than duplicated per role.
4. **The embedding dimension rides on the embed variant.** `embed.dimensions`
   replaces `EMBED_DIMENSIONS`: the number cannot be set without naming the embed
   model it belongs to. It remains the single source of truth for both the
   PgVector index and the Drizzle mirror in `@acme/rag`, which reads it from
   `@acme/models/env`. That is also why both keys are `shared` rather than
   `server` — they are browser-safe authored values, and `@acme/rag`'s
   `documents-schema` reads the dimension at module load in contexts (drizzle-kit,
   an app's schema barrel) where a `server` key would fail.
5. **Secrets are demanded from the resolved selection, at one eager entry
   point.** `validateModelSecrets()` calls only the active providers' `createEnv`
   groups: the AWS pair when Bedrock is either role, `OPENROUTER_API_KEY` when
   OpenRouter is chat, nothing for Ollama. It runs once at `resolve.ts` import, so
   a credential-less app still fails fast. This is **validation only** — the
   provider SDKs keep reading those credentials implicitly (Bedrock via the AWS
   chain, OpenRouter inside `createOpenRouter`) and the values are never threaded
   back into the factories. ADR 0001's decision 2 got the same "only the active
   provider is required" property by calling `createEnv` _inside_ each factory,
   which spread the rule across three files and tied it to the factory running.

## Considered and rejected

- **Keeping the flat enum plus sibling scalars** (`LLM_PROVIDER` +
  `LLM_MODEL` + `BEDROCK_REGION` + `OLLAMA_BASE_URL` + …). Every field has to be
  optional at the schema, because it applies to one provider and not the others,
  so the schema stops describing which combinations are valid and the resolvers
  need cross-provider guards. Rejected.
- **Per-field override of an authored role** (`MODELS_CHAT_MODEL` alongside
  `MODELS_CHAT`). Cheap for an operator changing one model id, but it reintroduces
  the partially-specified provider — and a field whose validity depends on a
  `provider` set elsewhere. Rejected.
- **A runtime `throw` for an OpenRouter embed selection**, keeping one provider
  enum for both roles. Moves a knowable-at-parse-time misconfiguration to first
  use, and leaves a branch that cannot be exercised once the schema is right.
  Rejected.
- **Scoping both keys `server`.** Strictly the safer default, but the embedding
  dimension is legitimately read outside a server runtime, and the alternative — a
  `NEXT_PUBLIC_` prefix on a value never read from the environment — would be a
  lie. Rejected.
- **Threading the resolved secret values into the provider factories.** Would
  make the factories impure and duplicate what each SDK's own credential
  resolution already does (notably the AWS chain, which reads far more than two
  variables). Validation-only keeps the fail-fast guarantee without owning the
  credential path. Rejected.

## Consequences

- Each resolver takes the **narrowed variant** rather than a bare provider
  string, so the pure core of `resolve.ts` (`resolveChatModel`,
  `resolveTitleModel`, `resolveEmbedModel`, `embedProviderOptionsFor`) reads no
  module-scope env and the whole provider matrix is table-testable without a
  credential per branch (`src/tests/backend/unit/resolve.test.ts`). The eager
  singletons stay thin caps that bind the selected variant.
- A profile overlay can flip a role per deploy target (dev `ollama` → prod
  `bedrock`). The deep merge carries the Ollama-only `baseUrl` into the merged
  object and zod object-strip drops it when the Bedrock variant validates, so an
  overlay never has to un-set the previous provider's fields.
- The authored development selection lives in `development-profile.ts`, a module
  that executes no `createEnv` call, so provisioning can read it without an
  environment: `scripts/resolve-compose-env.ts` derives the local Ollama port and
  the models to pull, and `scripts/resolve-infra.ts` decides whether the `ollama`
  compose profile is needed. Neither is duplicated in `.env.example`.
- Both roles' variant types are exported from `model-schemas.ts`, so a provider
  factory's parameter type is the schema's output and cannot drift from what the
  env validates.
