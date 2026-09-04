# Models (`@acme/models`)

The model layer: resolves the chat (LLM) and embedding models from env-selected
providers and hands AI-SDK model instances to the rest of the system. `@acme/rag`
and `@acme/chat` depend on this; it owns no RAG, persistence, or agent logic.

## Language

**Provider**:
A model backend selected by the slice's env (`MODELS_CHAT` / `MODELS_EMBED`).
`chat` and `embed` are **per-role discriminated unions** keyed by `provider`:
chat ∈ {`ollama`, `bedrock`, `openrouter`}; embed ∈ {`ollama`, `bedrock`} —
OpenRouter exposes no embeddings API. Selecting a provider carries (and
validates) only that provider's fields: Ollama has a `baseUrl`, Bedrock a
`region`, OpenRouter neither. _Avoid_: "vendor", "backend" (ambiguous with
infra).

**Chat / embed variant**:
The narrowed member of a role's union once `provider` is fixed — what a resolver
and a provider factory receive (`env.MODELS_CHAT` / `env.MODELS_EMBED`), never a
bare provider string. _Avoid_: "the provider string".

**Chat model / Title model / Embed model**:
The resolved AI-SDK instances (`chatModel`, `titleModel`, `embedModel`). Chat and
embed are resolved **independently** — the two providers need not match. The
title model is not a third role: it follows the chat provider, with an optional
cheaper model id. _Avoid_: "the model" (which one?).

**Embed provider options**:
The per-call options an embed request needs, keyed by purpose
(`embedProviderOptions('document' | 'query')`). Hides provider specifics from
callers — Bedrock's Cohere `inputType`, nothing for Ollama. It covers options
only: asymmetric Ollama models like `nomic-embed-text` want `search_document:` /
`search_query:` prefixes _on the text itself_, which this seam cannot carry and
does not inject. _Avoid_: "input type" at call sites (that's a Cohere-only detail
this abstraction exists to hide).

## Relationships

- **The embedding dimension is read from `@acme/models/env`, not the package
  root.** `@acme/rag` takes `MODELS_EMBED.dimensions` as the single source of
  truth for both the PgVector index and its Drizzle mirror. That module imports
  only zod, so a schema barrel or drizzle-kit reading the number never pulls
  provider resolution into its graph.
- **The authored development selection is what provisions local inference.**
  `scripts/resolve-compose-env.ts` and `scripts/resolve-infra.ts` read
  `development-profile.ts` without an environment — to derive the local Ollama
  port and the models to pull, and to decide whether the `ollama` compose profile
  is needed at all. Select hosted providers for both roles and that service drops
  out of the required set.
- **`@acme/ingest` declares the same AWS credential pair**, for S3. One variable,
  one value per process: the two agree wherever both are unauthored, and can only
  diverge in development with Bedrock selected.

## Decisions

See [`docs/adr/`](docs/adr/).
