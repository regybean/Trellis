# Mounting `@acme/logger`

Nothing to mount. Import the `logger` singleton and call it. No provider, no
route, no env, no infra — this is the shortest `ADAPTER.md` in the repo and that
is the point of reading it.

## Mounted by

All four apps, plus every platform/shared/feature package that logs.

## Glue

### Import and call — `apps/nextjs/src/app/api/health/route.ts`

```ts
import { logger } from '@acme/logger';

logger.error(`Health check failed ${JSON.stringify(errorResponse)}`);
```

### Structured form — `apps/nextjs/worker.ts`

```ts
import { logger } from '@acme/logger';

logger.info(
  { queue: QUEUE_NAMES.GENERATION, app: 'nextjs' },
  'generation worker: online',
);
```

Both call sites are the whole integration surface. `logger` is a module-level
`pino()` instance, so a consumer that wants a different sink swaps this package
rather than passing an option through an app.

### Where the output goes in dev

`pnpm dev` mirrors each app's stdout to `logs/*.log` (see
`docs/agents/dev-logs.md`). That is app tooling, not something this package
configures.

## Env

Factory: none. `@acme/logger` reads no environment.

## Infra

None — no `acme.infra`.

## Also mount

Nothing. `@acme/logger` has no `@acme/*` dependencies (`pino` only).
