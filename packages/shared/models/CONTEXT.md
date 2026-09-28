# Models (`@acme/models`)

The model layer: resolves the chat (LLM) and embedding models and hands AI-SDK
model instances to the rest of the system. `@acme/rag` and `@acme/chat` depend on
this; it owns no RAG, persistence, or agent logic.

**Connection** and **Model config** are specified and not yet built —
see [ADR 0003](docs/adr/0003-per-user-connections-and-model-configs.md). What
runs today is the env-authored selection of
[ADR 0002](docs/adr/0002-one-authored-value-per-role.md).

## Language

**Provider**:
A model backend — `ollama`, `bedrock` or `openrouter`. A Provider fixes which
connection params exist (Ollama a `baseUrl`, Bedrock a `region`, OpenRouter
neither) and which credential, if any, is needed. OpenRouter exposes no
embeddings API, so it can back a chat Model config and never an embed one.
_Avoid_: "vendor", "backend" (ambiguous with infra).

**Connection**:
A user's credentials for one Provider, under a label they choose — required, and
unique among that user's Connections. Holds that Provider's connection params and
its credential, and nothing about a model. The credential is **write-only**: the
plaintext never leaves the server, so the label and a few trailing characters are
the whole of what the UI can show. Ollama needs none and has none. _Avoid_:
"account", "provider config" (collides with Provider).

**Model config**:
A user's named choice of one model id on one Connection, for one Role. One
Connection backs many Model configs — a single Bedrock account hosts several
models — and deleting the Connection deletes them, because a model id without
credentials resolves to nothing. _Avoid_: "model" unqualified (that is the
resolved instance below), "profile".

**Role**:
What a Model config is for: `chat` or `embed`. Role is a property of the Model
config and Provider is a property of its Connection, so _"this Provider can
embed"_ spans two records and is checked when a Model config is created — it is
not, as under the env selection, unrepresentable. Title generation is not a Role.

**Default Model config**:
The one Model config a user has flagged per Role, resolved when a request names
none. At most one per user per Role, and a user may delete it and leave the Role
without one.

**Chat / embed variant**:
The narrowed member of a role's union once `provider` is fixed — what a resolver
and a provider factory receive (`env.MODELS_CHAT` / `env.MODELS_EMBED`), never a
bare provider string. Retires with the env selection it validates; the per-user
form of the same idea is a Connection plus a Model config. _Avoid_: "the provider
string".

**Chat model / Title model / Embed model**:
The resolved AI-SDK instances (`chatModel`, `titleModel`, `embedModel`). Chat and
embed resolve **independently** — their Connections need not share a Provider.
The title model is not a third Role: a chat Model config may point at another
chat Model config to generate thread titles with, and uses itself when it points
at none. _Avoid_: "the model" (which one?).

**Embed provider options**:
The per-call options an embed request needs, keyed by purpose
(`embedProviderOptions('document' | 'query')`). Hides provider specifics from
callers — Bedrock's Cohere `inputType`, nothing for Ollama. It covers options
only: asymmetric Ollama models like `nomic-embed-text` want `search_document:` /
`search_query:` prefixes _on the text itself_, which this seam cannot carry and
does not inject. _Avoid_: "input type" at call sites (that's a Cohere-only detail
this abstraction exists to hide).

## Relationships

- **An embedding dimension belongs to an embed model, but one column holds every
  user's vectors.** `@acme/rag` sizes the PgVector index and its Drizzle mirror
  from `@acme/models/env` at schema load, and that stays true while the knowledge
  base is one shared table. An embed Model config therefore records its dimension
  and is rejected at creation if it disagrees with the deployed width — vectors of
  the wrong width are not searchable, and failing at creation is the only place
  that is legible to the user.
- **The authored development selection is what provisions local inference.**
  `src/provisioning.ts` reads `development-profile.ts` without an environment —
  to derive the local Ollama port and the models to pull, and to decide whether
  the `ollama` compose profile is needed at all. `pnpm dev` and `pnpm infra:up`
  discover that declaration through this package's `acme.provisioning`. Select
  hosted providers for both roles and that service drops out of the required set.
- **`@acme/ingest` declares the same AWS credential pair**, for S3. One variable,
  one value per process: the two agree wherever both are unauthored, and can only
  diverge in development with Bedrock selected.

## Decisions

See [`docs/adr/`](docs/adr/).
