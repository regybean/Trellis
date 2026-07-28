# Models (`@acme/models`)

The model layer: resolves the chat (LLM) and embedding models from config-selected
providers and hands AI-SDK model instances to the rest of the system. `@acme/rag`
and `@acme/chat` depend on this; it owns no RAG, persistence, or agent logic.

## Language

**Provider**:
A model backend selected by config (`config.ts`, ADR 0026). `chat` and `embed` are
**per-role discriminated unions** keyed by `provider`: chat ∈ {`ollama`,
`bedrock`, `openrouter`}; embed ∈ {`ollama`, `bedrock`}. Selecting a provider
carries (and validates) only that provider's fields — Ollama has a `baseUrl`,
Bedrock a `region`, OpenRouter neither. _Avoid_: "vendor", "backend" (ambiguous
with infra).

**Chat / embed variant**:
The narrowed member of a role's union once `provider` is fixed — what a resolver
and provider factory receive (`config.chat` / `config.embed`), never a bare
provider string. Narrowing on `.provider` gives each factory exactly its fields,
so no cross-provider guards are needed.

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

**Lazy, per-provider secret validation**: each secret provider's env lives in its
own `createEnv` function in `env-providers.ts` (`bedrockEnv`, `openrouterEnv`),
called **inside** the provider factory. Only the active provider's factory runs
(see `resolve.ts`), so only its secrets are required — selecting `ollama` never
demands `OPENROUTER_API_KEY` (Ollama has no secret, so no env factory at all). A
missing/invalid secret for an _active_ provider still blocks eagerly at import,
matching the other `env.ts` files. Provider selection, model ids, region, base
URL and the embed dimension are config-as-code (`config.ts`), always validated.

**Discriminated unions make no-embed unrepresentable, single-authored connection
params**: `chat`/`embed` are `z.discriminatedUnion('provider', …)`, so the shared
`baseUrl` (Ollama) and `region` (Bedrock) leaf schemas are declared once and
**spread** into both roles' variants — no per-role duplication. OpenRouter is
absent from the `embed` union (it exposes no embeddings API), so an OpenRouter
embed selection fails at parse time and no-embed is structurally unrepresentable —
there is no runtime `throw` in `resolveEmbedModel`. A profile overlay may flip a
role's provider per deploy target (dev `ollama` → prod `bedrock`); the deep-merge
carries the Ollama-only `baseUrl` into the merged object and the union strips it
(zod object-strip) when the Bedrock variant validates.

**Variant-parameterised core, capped by eager singletons**: resolution is split in
`resolve.ts` into a pure core that reads no module-scope env — `resolveChatModel`/
`resolveTitleModel(config.chat)`, `resolveEmbedModel(config.embed)` and
`embedProviderOptionsFor(provider, purpose)`, each taking the **narrowed variant**
(dispatched via the `.provider` discriminant) rather than a bare provider string —
and thin caps (`chatModel`, `titleModel`, `embedModel`, `embedProviderOptions`)
that bind the config-selected variant and delegate. The split makes the provider
matrix table-testable (see `src/tests/unit/resolve.test.ts`) without a per-provider
secret for every branch. The caps stay eager at import (a missing/invalid secret
for an active provider still fails there, per ADR 0014 / 0024) — the build and
test infra rely on it.

**The embed dimension lives here, consumed by `@acme/rag`**: the embed model fixes
the vector dimension, so it rides with the selected embed variant
(`embed.dimensions`) and is the single source of truth for both the PgVector index
and the Drizzle mirror over in `@acme/rag`. Read from `@acme/models/config` (not
the package root) so the Drizzle schema doesn't pull in provider resolution.
Switching embed model means changing the dimension and re-pushing the schema; a
mismatch against an existing index fails with an actionable error in `@acme/rag`,
never a raw pgvector error.

**Ollama is the dev default, over the OpenAI-compatible endpoint**: Ollama serves
an OpenAI-compatible API on `/v1` covering both chat and embeddings, so a single
`@ai-sdk/openai-compatible` provider handles both. Default models are tiny and
CPU-only — for local dev/test, not production quality. The `config.ts` base
profile is the **single source** for the two ollama model IDs and the host port:
the local ollama container's pull list and `OLLAMA_PORT` are derived from it by
`scripts/resolve-compose-env.ts` (run by `scripts/compose.sh`, which parses the
port out of the ollama variant's `baseUrl`), not duplicated in `.env.example`
(ADR 0026, #120, #126).

## Known limitations

**No embedding task prefixes for Ollama**: asymmetric embed models like
`nomic-embed-text` expect `search_document:` / `search_query:` _prefixes on the
text itself_ (not a provider option). `embedProviderOptions` returns `{}` for
Ollama and we do **not** inject these prefixes, so dev-time retrieval quality is
degraded. Accepted: Ollama is for dev/test only. If it ever needs production-grade
recall, prefix the text in the uploader/query path for the Ollama embed provider.
