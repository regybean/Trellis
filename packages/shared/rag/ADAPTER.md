# Mounting `@acme/rag`

An app mounts this with one boot call and two drizzle-kit settings. There is no
route and no provider — the retrieval surface belongs to the features
(`@acme/chat`, `@acme/ingest`, `@acme/feedback`) that consume it.

The awkward part is DDL ownership, and it is worth reading before copying:
**Mastra owns its own tables** and creates them at runtime (ADR 0002), so
drizzle-kit must be told to leave them alone while still managing everything
around them.

## Mounted by

All four apps:

- `apps/nextjs` / `apps/nextjs-slim` — `src/instrumentation.ts`,
  `drizzle.config.ts`, `drizzle.push.config.ts`
- `apps/tanstack-start` / `apps/tanstack-slim` — `src/nitro/telemetry.ts`, same
  two drizzle configs

## Glue

### 1. Create the knowledge-base index at boot — `apps/nextjs/src/instrumentation.ts`

```ts
// Create the knowledge-base table at boot (Mastra owns the DDL — ADR-0002).
// PgVector creates it lazily on first upload, so a freshly-pushed vector DB
// has no table and reads (documents.list) throw "relation does not exist".
// Ensuring it here makes reads pure and surfaces an unreachable vector DB at
// startup, not the first request — same contract as provider resolution.
const { ensureVectorIndex } = await import('@acme/rag/server');
await ensureVectorIndex();
```

`apps/tanstack-start/src/nitro/telemetry.ts` does the same at its Nitro boundary.

Skip this and the app boots fine, then `documents.list` throws
`relation does not exist` on a freshly pushed vector database. `ensureVectorIndex`
is idempotent and caches its promise, clearing the cache on failure so a transient
error can be retried.

It also guards a dimension mismatch: if an index already exists at a different
dimension than the selected embed model's, it throws with an actionable message
rather than failing deep inside pgvector on every upsert.

### 2. Hide Mastra's tables from push — `apps/nextjs/drizzle.push.config.ts`

```ts
import base from './drizzle.config';

// `db:push`-only config. Mastra owns the DDL for every `mastra_`-prefixed table
// (see ADR-0002) and creates them at runtime; the Drizzle schema doesn't declare
// them. tablesFilter applies only to the tables push reads FROM the database (the
// current state) — not to the code-derived desired state — so its job here is to
// hide Mastra's runtime tables during introspection. Without `!mastra_*`, push
// would see those tables, find them absent from the code schema, and try to DROP
// them.
export default {
  ...base,
  tablesFilter: ['!mastra_*'],
  strict: false,
  verbose: false,
} satisfies Config;
```

### 3. Do **not** re-export the memory tables — `apps/nextjs/src/server/db/schema.ts`

```ts
// The Mastra Memory tables (`mastra_threads`, `mastra_messages`,
// `mastra_resources`) are intentionally NOT exported here: Mastra owns their DDL
// and creates them at runtime (ADR-0002), and the `!mastra_*` tablesFilter in
// drizzle.push.config.ts stops push from dropping them. They stay queryable via a
// direct import from `@acme/rag/schema` — a table doesn't need to be
// drizzle-kit-managed to be queried with drizzle-orm.
```

The omission is the mounting instruction. Exporting them makes push CREATE them,
which `tablesFilter` cannot prevent.

### 4. The per-app schema

```ts
schemaFilter: [process.env.NEXT_PUBLIC_WEBAPP ?? 'nextjs', 'auth'],
```

Mastra namespaces every table it creates under `NEXT_PUBLIC_WEBAPP`
(`CREATE SCHEMA IF NOT EXISTS` at runtime), giving multiple apps clean separation
inside one database. The name must match the app's `pgSchema(...)` and this
filter, or push and the queries resolve to different schemas.

### 5. Two databases, one server

The vector store lives in a **separate database** (`DB_VECTOR_NAME`) on the same
Postgres server, which is why `@acme/db`'s `createDb({ database })` is
parameterised at all — this is its one caller (ADR 0016):

```ts
// packages/shared/rag/src/vector.ts
export const pgVector = new PgVector({
  id: 'rag-pg-vector',
  host: dbEnv.DB_HOST,
  port: dbEnv.DB_PORT,
  database: env.DB_VECTOR_NAME,
  user: dbEnv.DB_USER,
  password: dbEnv.DB_PASSWORD,
  schemaName: RAG_SCHEMA,
});
```

Connection host/port/credentials come from `@acme/db`; only the vector database
_name_ is this slice's.

### 6. Thread ownership, for features

`@acme/rag/ownership-trpc` exports `assertOwnedThreadForTRPC` /
`mapOwnershipError` — what a consuming feature's procedures call so a principal
cannot read another's conversation. An app mounts nothing here.

## Env

Factory: `src/env.ts`, exported as `@acme/rag/env`.

| Key                      | Kind     | Authored development value                                                           |
| ------------------------ | -------- | ------------------------------------------------------------------------------------ |
| `DB_VECTOR_NAME`         | config   | `vectordb`                                                                           |
| `CHUNK_SIZE`             | config   | `1024`                                                                               |
| `CHUNK_OVERLAP`          | config   | `20`                                                                                 |
| `MEMORY_LAST_MESSAGES`   | config   | `15`                                                                                 |
| `MEMORY_SEMANTIC_RECALL` | config   | `false` — goes through `jsonEnv`, not `z.coerce.boolean()`, so `'false'` stays false |
| `MEMORY_TITLE_WORD_CAP`  | config   | `6`                                                                                  |
| `NEXT_PUBLIC_WEBAPP`     | selector | names the Postgres/pgvector schema                                                   |
| `NODE_ENV`               | selector | shared                                                                               |

No secrets. All server-side.

`DB_VECTOR_NAME` is also read by `scripts/resolve-compose-env.ts` from
`src/development-profile.ts`, so overriding the variable points a _connection_ at
a different database and does not rename the one compose creates.

## Infra

`acme.infra: ["postgres", "ollama"]`:

- **postgres** → the `postgres` profile in `deploy/compose.yaml`. The image is
  `pgvector/pgvector:pg17` because of this package; `deploy/ops/db-init/01-vector.sh`
  creates the `${DB_VECTOR_NAME}` database alongside the app one and installs the
  extension in both.
- **ollama** → the `ollama` profile, kept or dropped by
  `scripts/resolve-infra.ts` depending on whether `@acme/models`' authored
  selection uses it. Embeddings and chat both go through the OpenAI-compatible
  `/v1` endpoint of one container.

## Also mount

`@acme/db` (connection + drizzle configs), `@acme/models` (the embed model, whose
`dimensions` fix the index dimension), `@acme/logger`, `@acme/env`. Add
`drizzle-kit` to the app for the configs above. The Mastra packages
(`@mastra/core`, `@mastra/pg`, `@mastra/rag`, `@mastra/memory`) are this
package's dependencies, not the app's.
