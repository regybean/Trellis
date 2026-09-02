# Mounting `@acme/db`

An app mounts this in two places: its **drizzle-kit configs** (so `db:push` /
`db:generate` / `db:migrate` run against the resolved connection) and its
**schema barrel** (so drizzle-kit owns the DDL for the tables the app decides to
manage). `createDb()` itself is called by feature packages, not by the app.

## Mounted by

All four apps, in `drizzle.config.ts`, `drizzle.push.config.ts` and
`src/server/db/schema.ts`.

## Glue

### 1. drizzle-kit config — `apps/nextjs/drizzle.config.ts`

```ts
import type { Config } from 'drizzle-kit';

import { DRIZZLE_CASING } from '@acme/db';
import { env } from '@acme/db/env';

export default {
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  // Connection is authored config (ADR 0033): `@acme/db/env` resolves the profile
  // defaults + the runtime host/port override drizzle-kit push needs.
  dbCredentials: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: false,
  },
  schemaFilter: [process.env.NEXT_PUBLIC_WEBAPP ?? 'nextjs', 'auth'],
  tablesFilter: ['*'],
  out: './migrations/db',
  // Shared with `createDb()` rather than repeated here: drizzle-kit writes the
  // DDL from this and drizzle-orm writes the queries from the same constant, so
  // the two cannot drift into naming columns differently. See @acme/db/casing.
  casing: DRIZZLE_CASING,
  verbose: true,
  strict: true,
} satisfies Config;
```

`DRIZZLE_CASING` is the part worth copying deliberately. Import it rather than
retyping the casing option — drizzle-kit writes DDL from this config and
drizzle-orm writes queries from the same constant, so a local literal is a
column-naming drift waiting to happen.

### 2. The per-app Postgres schema — `apps/nextjs/src/server/app-schema.ts`

```ts
/* eslint-disable no-restricted-properties */
import { pgSchema } from 'drizzle-orm/pg-core';

export const appSchema = pgSchema(process.env.NEXT_PUBLIC_WEBAPP ?? 'nextjs');
```

The name must match the `schemaFilter` fallback above, so push, generate and the
schema object all resolve to the same Postgres schema.

### 3. The schema barrel — `apps/nextjs/src/server/db/schema.ts`

```ts
export { appSchema } from '../app-schema';

// App-owned, drizzle-kit-managed tables. Re-exported from their feature packages
// so push/generate own their DDL (the feature defines the columns; the app
// decides to manage them).
export { messageFeedback, feedbackRating } from '@acme/feedback/schema';
export { chatFolder } from '@acme/chat/schema';

export {
  authSchema,
  authUser,
  authSession,
  authAccount,
  authVerification,
} from '@acme/auth/schema';
```

drizzle-kit manages exactly what this file exports. Mounting a feature's tables
is re-exporting them here; leaving them out means the feature's package is
present but its tables are not managed.

### 4. Who calls `createDb()`

Feature packages do:

```ts
// packages/platform/db/src/client.ts — the signature a feature calls
export function createDb({
  database = env.DB_NAME,
}: { database?: string } = {}) { … }
```

`database` is parameterised for exactly one caller, `@acme/rag`, which connects
to the dedicated vector database (`DB_VECTOR_NAME`). That is why there is no
separate `vdb` package (ADR 0016). An app does not normally call this.

### 5. Order of operations on a fresh database

Run drizzle first, then boot the app: `pnpm db:push` (or `db:migrate`) before
`pnpm dev`. Mastra owns the DDL for its own tables and creates them at runtime
(ADR 0002), so a booted-but-unpushed app has neither.

## Env

Factory: `src/env.ts`, exported as `@acme/db/env`.

| Key           | Kind   | Notes                                                                                                                   |
| ------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `DB_HOST`     | config | authored `localhost`; **must** be overridable (testcontainers, prod endpoints)                                          |
| `DB_PORT`     | config | authored `5444` — deliberately not 5432, so the published container port cannot collide with another project's Postgres |
| `DB_USER`     | config | authored `postgres`                                                                                                     |
| `DB_NAME`     | config | authored `testdb`                                                                                                       |
| `DB_PASSWORD` | secret | no profile value on any target; locally from `deploy/.env`                                                              |

`DB_PASSWORD` is the one credential whose container this repo provisions and
whose value a real deploy must never inherit by accident.

Note the provisioning boundary (ADR 0033 §6): `src/development-profile.ts` — not
`env.ts` — is what `@acme/db/testing` and `scripts/resolve-compose-env.ts` read,
so overriding `DB_NAME` points a _connection_ at a different database and does
not rename the one compose creates.

## Infra

`acme.infra: ["postgres"]` → the `postgres` profile in `deploy/compose.yaml`
(`pgvector/pgvector:pg17`, published on `${DB_PORT}` → 5444, container-internal
5432). The image is pgvector rather than plain Postgres because `@acme/rag`
shares this server; the init scripts in `deploy/ops/db-init` create the vector
database alongside the app one.

`@acme/db/testing` exports the matching testcontainer descriptor, so backend
suites self-provision (ADR 0034).

## Also mount

`@acme/env` (its env factory). Add `drizzle-kit` to the app's devDependencies —
the configs above are drizzle-kit's, not this package's.
