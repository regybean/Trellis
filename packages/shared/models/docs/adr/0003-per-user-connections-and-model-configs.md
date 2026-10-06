# Per-user Connections and Model configs

**Status:** accepted

> **Amends [ADR 0002](0002-one-authored-value-per-role.md) on who authors a
> selection, and on one property it claimed.** A selection stops being a single
> env-authored value per role and becomes two user-owned records: a
> **Connection** (credentials for one Provider) and a **Model config** (a model
> id on that Connection, for one Role). How much of the env selection survives
> alongside them is not settled here.

A user's model selection splits into **Connection** and **Model config**, one
Connection to many Model configs. The split is the point: one Bedrock account
hosts several models, and the credential should be stated once. Both records are
owned by a user and carry `user_id` directly rather than reaching it through a
join — the sealed credential's AAD already binds `<userId>:<connectionId>`, so
the pairing is load-bearing, and filtering on that owner column is the
privacy boundary: no read reaches another user's records.
Each carries a required label, unique per user, because a write-only credential
leaves the label as the only handle the UI has.

Six decisions are load-bearing:

1. **The discriminated union survives at the parse boundary, not in the column
   set.** A Connection stores its Provider as a discriminant and that Provider's
   params as one validated JSON document, so a half-configured Provider is still
   unrepresentable, and adding a Provider is a new union member rather than a
   migration. This is [ADR 0002](0002-one-authored-value-per-role.md)'s decision
   1 — the selection is one whole document, never per-field — carried into
   storage. The price is that no Provider-specific param is indexable, which
   nothing asks for.

2. **"This Provider can embed" becomes a creation-time rejection.** Role lives on
   the Model config and Provider on its Connection, so the constraint spans two
   records and no type can express it;
   [ADR 0002](0002-one-authored-value-per-role.md)'s decision 2 — OpenRouter
   simply absent from the embed union — does not survive the split. What does
   survive is downstream: a _loaded_ embed Model config narrows to
   `ollama | bedrock`, so the resolvers stay total and `throw`-free. The check
   moves to the one place a user can act on it.

3. **The credential is a Provider-specific object, sealed into one nullable
   column.** Bedrock needs an access-key pair, OpenRouter one key, Ollama
   nothing, so "a Connection has a credential" is false in general and the sealed
   column is nullable. The plaintext is JSON, and which fields are required is
   part of the same union that validates the params. Sealing happens at the edge
   of the create/update procedure, so the union's output type is the _unsealed_
   shape and plaintext never has a resting place. The sealed format itself is
   `@acme/secrets`' decision, not this one.

4. **The title model is a link, not a Role.** Roles are `chat` and `embed`; a
   chat Model config carries a nullable self-reference to another chat Model
   config to generate titles with, cleared rather than cascaded when that target
   is deleted, and meaning "use the chat model itself" when null — which is what
   every factory already does today. A cheap model can therefore serve as the
   title model for several chat configs, and it stays selectable as a chat model
   in its own right, which a third Role would have denied.

5. **Defaultness is a flag on the Model config, not a selection record.** At most
   one per user per Role. A separate selection record would have to exist before
   any Model config did, which fights the lazy, per-user materialisation this
   design depends on. A user may delete their default and leave a Role without
   one; materialisation must therefore be gated on a per-user watermark rather
   than on a zero-row count, or deleting the last config silently resurrects it.

6. **A Model config is identity, not behaviour.** Generation params — temperature,
   max tokens, system prompt — are excluded. They belong to the Agent, which this
   effort deliberately does not specify, and admitting them now would mean
   un-picking the same params from two owners later.

## Considered and rejected

- **Widened nullable columns** (`base_url`, `region`, …) with the union
  re-imposed in zod. Every column is nullable because it applies to one Provider
  and not the others, so the table stops describing which combinations are valid
  — the same failure [ADR 0002](0002-one-authored-value-per-role.md) rejected the
  flat enum for. Rejected.
- **A table per Provider.** Preserves the union structurally, at the cost of a
  migration per Provider and a polymorphic foreign key from every Model config.
  Rejected.
- **Separate chat and embed Model config tables**, to keep the embed union free
  of OpenRouter. It does not achieve that — Provider is on the Connection either
  way, so the cross-record check remains — and it duplicates every column the two
  share. Rejected.
- **A third `title` Role.** Makes a model that is an ordinary chat model
  unusable as one, and gives the title model a lifecycle of its own for no gain.
  Rejected.
- **A `user_model_selection` record holding the active chat and embed configs.**
  Needs bootstrapping before anything exists to point at. Rejected.

## Consequences

- `@acme/models` gains a Postgres schema and a tRPC router, as `@acme/auth` and
  `@acme/rag` already have, while `@acme/models/env` stays the zod-only module
  `@acme/rag` imports at schema-load time — so drizzle-kit and an app's schema
  barrel never pull the new router graph.
- The embedding dimension keeps sizing one shared PgVector column from env, and
  an embed Model config that disagrees with the deployed width is rejected at
  creation. Per-index sizing is the knowledge-bases effort's, and this schema is
  additive to it rather than a change it has to make.
- Deleting a Connection deletes its Model configs, including one that is another
  config's title model — that link is cleared, not cascaded, so the referring
  config falls back to titling with itself rather than disappearing.
