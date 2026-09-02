# Mounting `@acme/env`

An app mounts this by writing its own `src/env.ts` — one `createEnv` call that
`extends` every slice's env factory. `@acme/env` supplies the pieces that call
needs (`resolveAppEnv`, `withProfiles`, `readEnv`, `jsonEnv`, `webappSchema`) and
authors no keys of its own. There is no provider and no route.

## Mounted by

All four apps, each in `src/env.ts`.

## Glue

### The app's one composition edge — `apps/nextjs/src/env.ts`

```ts
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { betterAuthEnv } from '@acme/auth/env';
import { billingEnv } from '@acme/billing/env';
import { chatEnv } from '@acme/chat/env';
import { readEnv, resolveAppEnv, withProfiles } from '@acme/env';
import { ingestEnv } from '@acme/ingest/env';

export const appEnv = resolveAppEnv(process.env.APP_ENV);

export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  extends: [chatEnv(), ingestEnv(), billingEnv(), betterAuthEnv()],
  server: {
    BETTER_AUTH_URL: z.url(),
  },
  client: {},
  createFinalSchema: (shape) =>
    withProfiles(shape, appEnv, {
      default: { BETTER_AUTH_URL: 'http://localhost:3000' },
    }),
  runtimeEnv: {
    BETTER_AUTH_URL: readEnv('BETTER_AUTH_URL'),
  },
});
```

`apps/nextjs-slim/src/env.ts` is the same shape with a shorter `extends` list
(`[chatEnv(), ingestEnv()]`) and no keys of its own — composing an app is
composing that list.

Two constraints this file carries, both from ADR 0033: `skipValidation` is never
passed, and `createFinalSchema` is written as an inline arrow so `shape`'s type
flows in from the sibling `server`/`client` dictionaries (that is what makes a
wrong profile literal a compile error).

### `APP_ENV` must be inlined by the bundler — `apps/nextjs/next.config.js`

```js
const config = {
  // Inline the deploy-target selector into both the server and
  // client bundles so `resolveAppEnv(process.env.APP_ENV)` in env.ts resolves
  // identically in each (ADR 0026 §5). Unset → '' → the `development` base.
  env: { APP_ENV: process.env.APP_ENV ?? '' },
};
```

Without it a slice that builds its env in the browser resolves a different
profile server-side and client-side.

### Boot-time validation — `apps/nextjs/next.config.js`

```js
const jiti = createJiti(import.meta.url);
await jiti.import('./src/env');
```

Evaluating the composed env from the config is what makes a misconfigured app
fail at build/boot rather than on the first request.

### The `process.env` guard

The app's `src/env.ts` is one of the few files exempt from the ESLint
`no-restricted-properties` guard on `process.env`. Everywhere else, reads go
through `readEnv` — except the bundler-inlined keys (`NEXT_PUBLIC_*`, `APP_ENV`,
`NODE_ENV`), which stay written longhand because inlining is textual
substitution and an index access is invisible to it.

## Env

Factory: none — this package is the mechanism, not a slice.
Keys it reads directly: `APP_ENV` (via `resolveAppEnv`).
Keys it declares a schema for and other slices reuse: `NEXT_PUBLIC_WEBAPP` (via
`webappSchema` — a Postgres-identifier constraint, declared once because six
slices declare the key).

## Infra

None — no `acme.infra`.

## Also mount

Nothing. `@acme/env` has no `@acme/*` dependencies.
