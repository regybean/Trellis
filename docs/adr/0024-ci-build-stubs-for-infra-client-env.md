# CI build stubs for infrastructure-client env vars

**Status:** amended by ../../packages/platform/env/docs/adr/0001-one-env-factory-per-slice.md

> **Rationale updated by [@acme/env ADR 0001](../../packages/platform/env/docs/adr/0001-one-env-factory-per-slice.md) §3.** The
> stub table below still holds, but not for the reason given here. An
> `IS_NEXT_BUILD` run no longer skips coercion: `withProfiles` always builds and
> parses the schema, relaxing only the keys no profile authors. So the stubs no
> longer "bypass T3 entirely" — they are parsed and coerced like any other input,
> which means a stub must now be a **valid** value for its schema rather than any
> non-empty string. That is a tightening, and the values in the table already
> satisfy it. The stubs are still needed for the reason this ADR identified: they
> exist to satisfy the infrastructure clients' own constructor guards, which run
> at module import regardless of what env validation does. Keys that now carry an
> authored profile value need no stub at all.

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

The parallel-worktree case is solved by symlinking the primary checkout's `.env`
into the worktree (`scripts/link-worktree-env.mjs`). CI has no primary checkout to inherit from, so the symlink approach
does not apply.

## Decision

Add stub env vars to the CI `typecheck` and `build` jobs. Stubs are fake but syntactically
valid — they satisfy constructor-level validation without making any network connections
(infrastructure clients connect lazily on first query, not at construction).

Stubs declared in CI:

| Var                  | Stub value  | Why needed                                                |
| -------------------- | ----------- | --------------------------------------------------------- |
| `DB_HOST`            | `localhost` | PgVector / PostgresStore validate non-empty host          |
| `DB_PORT`            | `5432`      | Passed to constructor; accepts string with skipValidation |
| `DB_USER`            | `stub`      | PgVector / PostgresStore constructor param                |
| `DB_PASSWORD`        | `stub`      | PgVector / PostgresStore constructor param                |
| `DB_NAME`            | `stub`      | PostgresStore `database` param                            |
| `DB_VECTOR_NAME`     | `stub`      | PgVector `database` param (rag env)                       |
| `NEXT_PUBLIC_WEBAPP` | `stub`      | PgVector `schemaName` = `RAG_SCHEMA`                      |

**The model-provider keys are no longer in this set.** `LLM_PROVIDER`,
`EMBED_PROVIDER`, `EMBED_DIMENSIONS` and the three `OLLAMA_*` vars were listed
here while `@acme/models` declared a provider enum plus per-provider keys. It
now declares two keys — `MODELS_CHAT` and `MODELS_EMBED`, each a `jsonEnv`
discriminated union — and both carry an authored profile value, so by the rule
in the blockquote above they need no stub. (`OLLAMA_CHAT_MODEL` /
`OLLAMA_EMBED_MODEL` still exist, but as values
`scripts/resolve-compose-env.ts` _derives_ for the Ollama pull list in compose;
no slice's `createEnv` reads them, so no constructor guard depends on them at
import.)

These stubs exist to satisfy Mastra/AI-SDK constructor guards, which run at module
import whatever env validation does. (As noted at the top: since @acme/env ADR 0001 §3 they are
also coerced and validated by the slice's schema rather than bypassing it, so each one
has to be a legal value for its key — which is why `DB_PORT` is `5432` and not
`stub`.) All stub
vars are also listed in `turbo.json` `globalEnv` — turbo filters subprocess env to declared
vars only, so CI step env vars are silently dropped unless listed there.

## Considered and rejected

- **Lazy-init `pgVector`** (`??=` getter / factory). Rejected once already —
  larger blast radius, env at build is not actually wrong to require.
- **Guard with `IS_NEXT_BUILD` in `vector.ts`**. Same class as lazy-init: defers
  construction behind a conditional, silently breaking any code that touches `pgVector`
  during a build step. The stub approach is honest — if build truly needed DB access
  it would fail, and that failure would be real.
- **Skip build in CI / make it report-only**. Build is a gate, not a report: a broken
  build must block merges.
- **Add real DB secrets to CI**. Overkill — no DB is actually queried during build.

## Consequences

- If a new module-level infrastructure client is added that validates constructor params,
  its required env var must also be added to the CI stub set. Omitting it produces the
  same class of error (constructor throws, build fails) making it easy to detect.
- The stub vars are only present in `typecheck` and `build` CI jobs; test jobs still use
  real env from testcontainers ([ADR 0014](0014-tests-validate-real-env.md)).
