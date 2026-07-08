# CI build stubs for infrastructure-client env vars

`shouldSkipEnvValidation()=true` during `IS_NEXT_BUILD` skips T3 schema coercion but
**not** the infrastructure client constructors (`PgVector`, `PostgresStore` from
`@mastra/pg`) which do their own non-empty host validation at instantiation time. Those
clients are module-level singletons — they are constructed the moment a route-handler
module is imported. Next.js imports route handlers during `next build` to collect page
data, which triggers the full import chain:

```
/api/trpc/chat/[trpc]/route.ts
  → @acme/chat/server (appRouter)
    → chatAgent (chat-agent.ts)
      → pgVector from @acme/rag
        → new PgVector({ host: dbEnv.DB_HOST })  ← throws when DB_HOST is undefined
```

With `IS_NEXT_BUILD=true`, `dbEnv.DB_HOST` is `process.env.DB_HOST` (raw, unvalidated).
In CI the var is absent, so host is `undefined`, and the constructor throws:
`PgVector: host must be provided and cannot be empty`.

ADR 0022 solved the parallel worktree problem by symlinking the primary checkout's `.env`
into the worktree. CI has no primary checkout to inherit from, so the symlink approach
does not apply.

## Decision

Add stub env vars to the CI `typecheck` and `build` jobs. Stubs are fake but syntactically
valid — they satisfy constructor-level validation without making any network connections
(infrastructure clients connect lazily on first query, not at construction).

Stubs declared in CI:

| Var                  | Stub value               | Why needed                                                |
| -------------------- | ------------------------ | --------------------------------------------------------- |
| `DB_HOST`            | `localhost`              | PgVector / PostgresStore validate non-empty host          |
| `DB_PORT`            | `5432`                   | Passed to constructor; accepts string with skipValidation |
| `DB_USER`            | `stub`                   | PgVector / PostgresStore constructor param                |
| `DB_PASSWORD`        | `stub`                   | PgVector / PostgresStore constructor param                |
| `DB_NAME`            | `stub`                   | PostgresStore `database` param                            |
| `DB_VECTOR_NAME`     | `stub`                   | PgVector `database` param (rag env)                       |
| `NEXT_PUBLIC_WEBAPP` | `stub`                   | PgVector `schemaName` = `RAG_SCHEMA`                      |
| `LLM_PROVIDER`       | `ollama`                 | `resolveChatModel()` switch falls through on undefined    |
| `EMBED_PROVIDER`     | `ollama`                 | `resolveEmbedModel()` switch falls through on undefined   |
| `EMBED_DIMENSIONS`   | `768`                    | Avoids undefined in vector index dimension                |
| `OLLAMA_BASE_URL`    | `http://localhost:11434` | ollama provider URL; must be valid URL format             |
| `OLLAMA_CHAT_MODEL`  | `stub`                   | ollama chat model id                                      |
| `OLLAMA_EMBED_MODEL` | `stub`                   | ollama embed model id                                     |

T3 env validation is already skipped (`shouldSkipEnvValidation()=true`), so these stubs
bypass T3 entirely. They exist only to satisfy Mastra/AI-SDK constructor guards. All stub
vars are also listed in `turbo.json` `globalEnv` — turbo filters subprocess env to declared
vars only, so CI step env vars are silently dropped unless listed there.

## Considered and rejected

- **Lazy-init `pgVector`** (`??=` getter / factory). Already rejected in ADR 0022 —
  larger blast radius, env at build is not actually wrong to require.
- **Guard with `IS_NEXT_BUILD` in `vector.ts`**. Same class as lazy-init: defers
  construction behind a conditional, silently breaking any code that touches `pgVector`
  during a build step. The stub approach is honest — if build truly needed DB access
  it would fail, and that failure would be real.
- **Skip build in CI / make it report-only**. Build is a gate, not a report: a broken
  build must block merges.
- **Add real DB secrets to CI**. Overkill — no DB is actually queried during build.

## Status

accepted

## Consequences

- If a new module-level infrastructure client is added that validates constructor params,
  its required env var must also be added to the CI stub set. Omitting it produces the
  same class of error (constructor throws, build fails) making it easy to detect.
- The stub vars are only present in `typecheck` and `build` CI jobs; test jobs still use
  real env from testcontainers (ADR 0014 / ADR 0019).
