# Multi-provider models behind a single `@acme/models` package

Chat (LLM) and embedding models are no longer hard-wired to AWS Bedrock. A new
shared package `@acme/models` owns provider selection and hands resolved AI-SDK
model instances to `@acme/rag` (embeddings) and `@acme/chat` (chat + retrieval).
Three providers ship: **Bedrock**, **OpenRouter** (chat only), and **Ollama**
(local, CPU-only, chat + embeddings). Ollama is the default so the repo runs with
no cloud credentials. Four decisions are load-bearing:

1. **One package, one file per provider — not a package per provider.** Provider
   factories live in sibling files (`bedrock.ts`, `openrouter.ts`, `ollama.ts`)
   behind a single `resolve.ts` selector that switches on `LLM_PROVIDER` /
   `EMBED_PROVIDER` and exports eager-resolved `chatModel` / `embedModel`.
2. **Lazy, per-provider env validation.** Each provider's envs are a separate
   `createEnv` block, called *inside* its factory. Only the selected provider's
   factory runs, so only its envs are required — selecting `ollama` never demands
   `OPENROUTER_API_KEY`. A missing/invalid env for an *active* provider still
   blocks eagerly at import, matching the other `env.ts` files.
3. **Chat and embedding providers are selected independently.** `LLM_PROVIDER` and
   `EMBED_PROVIDER` are distinct; e.g. OpenRouter chat + Ollama embeddings is
   valid. `EMBED_PROVIDER` excludes `openrouter` (no embeddings API) at the zod
   enum, so the invalid combination fails with a clear parse error.
4. **Embedding dimension is env-driven with a preflight guard.** The embed model
   fixes the vector dimension, so `EMBED_DIMENSIONS` lives in `@acme/models` and is
   the single source of truth for both the PgVector index and the Drizzle mirror in
   `@acme/rag`. A mismatch against an existing index fails up front with an
   actionable error ("drop the vector DB and `pnpm db:push`"), never a raw pgvector
   error.

Infrastructure follows selection: the `ollama` compose profile (and the container)
starts only when a provider is `ollama`, gated by `scripts/infra.sh` via
`COMPOSE_PROFILES`.

## Status

accepted

Amends decision 3 of [ADR 0002](./0002-mastra-rag-and-memory.md) ("Bedrock via an
AI-SDK provider instance"): the AI-SDK-instance approach stands, but the instance is
now produced by `@acme/models`, one of three providers, not constructed in
`@acme/rag`.

## Considered and rejected

- **A package per provider (`@acme/models-bedrock`, …) to "uninstall the ones you
  don't use".** The static import graph in `resolve.ts` references every provider
  regardless, so separate packages buy no decoupling — only more workspace wiring.
  Removing a provider is already a three-line change (delete file, drop `case`,
  `pnpm remove` the SDK). Rejected.
- **A single conditional env schema (one `createEnv`, fields required based on the
  selected provider).** Conditional zod across providers is harder to read and
  couples every provider's fields into one block. Separate per-provider `createEnv`
  functions keep each provider's contract local and the "only the active provider is
  validated" property obvious. Rejected.
- **Baking the embedding dimension in (a constant per embed model).** Forces a code
  change to switch embed model and lets the index/mirror silently disagree.
  Env-driven + preflight guard is safer and keeps one source of truth. Rejected.
- **GPU Ollama / larger default models.** The default must run on any dev laptop in
  CI-less local use; tiny CPU models (`qwen2.5:1.5b`, `nomic-embed-text`) trade
  quality for "works everywhere". Production uses Bedrock/OpenRouter. Rejected for
  the default.

## Consequences

- New package `@acme/models` (shared layer). `@acme/rag` and `@acme/chat` depend on
  it; `@acme/rag` lost its `bedrock.ts` and its `@ai-sdk/amazon-bedrock` dependency,
  and the AWS/Bedrock envs moved out of `@acme/rag` and `@acme/chat` into
  `@acme/models`'s `bedrockEnv`.
- `embedProviderOptions('document' | 'query')` hides provider-specific embed options
  (Bedrock's Cohere `inputType`; nothing for Ollama) from call sites in the uploader
  and the vector query tool.
- **Ollama embeddings are degraded in dev.** Asymmetric models like
  `nomic-embed-text` expect `search_document:` / `search_query:` *text prefixes*
  (not a provider option); we do not inject them, so dev-time recall is weaker.
  Accepted — Ollama is dev/test only.
- `scripts/infra.sh` now fronts the `infra:*` scripts (via `with-env`) to gate the
  `ollama` profile on provider selection; `pnpm infra:up` no longer passes a literal
  `--profile infra`.
