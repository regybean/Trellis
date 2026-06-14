# Models (`@acme/models`)

The model layer: resolves the chat (LLM) and embedding models from env-selected
providers and hands AI-SDK model instances to the rest of the system. `@acme/rag`
and `@acme/chat` depend on this; it owns no RAG, persistence, or agent logic.

## Language

**Provider**:
A model backend selected by env. `LLM_PROVIDER` ∈ {`bedrock`, `openrouter`,
`ollama`}; `EMBED_PROVIDER` ∈ {`bedrock`, `ollama`}. _Avoid_: "vendor", "backend"
(ambiguous with infra).

**Chat model / Embed model**:
The two resolved AI-SDK instances (`chatModel`, `embedModel`). Resolved
**independently** — the chat and embed providers need not match. _Avoid_: "the
model" (which one?).

**Embed provider options**:
The per-call options an embed request needs, keyed by purpose
(`embedProviderOptions('document' | 'query')`). Hides provider specifics from
callers — Bedrock's Cohere `inputType`, nothing for Ollama. _Avoid_: "input type"
at call sites (that's a Cohere-only detail this abstraction exists to hide).

## Design decisions

**One package, one file per provider — not a package per provider**: provider
abstractions live in sibling files (`bedrock.ts`, `openrouter.ts`, `ollama.ts`)
behind a single `resolve.ts` selector. Splitting into installable packages was
considered (to "uninstall the ones you don't use") and rejected: the static
import graph in `resolve.ts` couples the selector to every provider regardless,
so separate packages buy no decoupling. Deleting a provider is: delete its file,
drop its `case`, `pnpm remove` its SDK.

**Lazy, per-provider env validation**: each provider's envs live in their own
`createEnv` function in `env.ts` (`bedrockEnv`, `openrouterEnv`, `ollamaEnv`),
called **inside** the provider factory. Only the active provider's factory runs
(see `resolve.ts`), so only its envs are required — selecting `ollama` never
demands `OPENROUTER_API_KEY`. A missing/invalid env for an _active_ provider still
blocks eagerly at import, matching the other `env.ts` files. `modelsEnv`
(provider selection + `EMBED_DIMENSIONS`) is always validated.

**`EMBED_DIMENSIONS` lives here, consumed by `@acme/rag`**: the embed model fixes
the vector dimension, so it is configured (not baked in) and is the single source
of truth for both the PgVector index and the Drizzle mirror over in `@acme/rag`.
Imported from `@acme/models/env` (not the package root) so the Drizzle schema
doesn't pull in provider resolution. Switching embed model means changing the
dimension and re-pushing the schema; a mismatch against an existing index fails
with an actionable error in `@acme/rag`, never a raw pgvector error.

**Ollama is the dev default, over the OpenAI-compatible endpoint**: Ollama serves
an OpenAI-compatible API on `/v1` covering both chat and embeddings, so a single
`@ai-sdk/openai-compatible` provider handles both. Default models are tiny and
CPU-only — for local dev/test, not production quality.

## Known limitations

**No embedding task prefixes for Ollama**: asymmetric embed models like
`nomic-embed-text` expect `search_document:` / `search_query:` _prefixes on the
text itself_ (not a provider option). `embedProviderOptions` returns `{}` for
Ollama and we do **not** inject these prefixes, so dev-time retrieval quality is
degraded. Accepted: Ollama is for dev/test only. If it ever needs production-grade
recall, prefix the text in the uploader/query path for the Ollama embed provider.
