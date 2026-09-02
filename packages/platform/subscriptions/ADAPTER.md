# Mounting `@acme/subscriptions`

An app mounts this by building one `EntitlementsProvider` from it and injecting
that same instance everywhere entitlements are read: the tRPC context seam and
the worker. It is the Stripe/Redis-backed alternative to
`unlimitedEntitlements` — the full apps mount this, the slim apps mount
`@acme/entitlements` instead (ADR 0010).

The provider takes its plan ids as an argument. This package does **not** read
Stripe env; `@acme/billing`'s env owns those keys and the app threads them in.

## Mounted by

- `apps/nextjs` — `src/server/trpc-route.ts`, `worker.ts`
- `apps/tanstack-start` — `src/lib/trpc-context.ts`, `src/lib/stripe.ts`, `worker.ts`

## Glue

### 1. Build the provider once — `apps/nextjs/src/server/trpc-route.ts`

```ts
import { env as billingEnv, toPlanIds } from '@acme/billing/env';
import { createSubscriptionsEntitlements } from '@acme/subscriptions';

/**
 * The Stripe/Redis entitlements provider, closing over the plan ids billing's
 * own env resolves (ADR 0033) — the product→tier mapping needs them, and the
 * platform no longer reads them from `process.env`.
 */
const entitlements = createSubscriptionsEntitlements(toPlanIds(billingEnv));

const resolveContext = async (req: Request) => ({
  headers: req.headers,
  req,
  origin: new URL(req.url).origin,
  session: await resolveSession(req),
  entitlements,
});
```

`apps/tanstack-start/src/lib/trpc-context.ts` is the same two lines on the other
framework.

### 2. The worker injects the same provider — `apps/nextjs/worker.ts`

```ts
// Inject the SAME provider this app's route handler injects into
// `createTRPCContext` (ADR 0006 / ADR 0010): the Stripe/Redis-backed adapter,
// built from the plan ids billing's own env resolves (ADR 0033), so a worker
// error refunds the real Credit ledger.
const entitlements = createSubscriptionsEntitlements(toPlanIds(billingEnv));
const worker = createWorker(
  QUEUE_NAMES.GENERATION,
  createChatGenerationProcessor(entitlements),
);
```

This is the mistake to avoid: charge through the Stripe/Redis ledger in the route
handler and refund through `unlimitedEntitlements` in the worker, and Credits
leak on every failed Turn.

### 3. Reading a customer mapping directly — `apps/tanstack-start/src/lib/stripe.ts`

```ts
import { localstripeMode, syncStripeDataToKV } from '@acme/billing/server';
import { getStripeCustomerId } from '@acme/subscriptions';

import { auth } from '~/lib/auth-server';

export const syncStripeOnSuccess = createServerFn({ method: 'POST' }).handler(
  async () => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() });
    if (!session) {
      throw redirect({ to: '/sign-in' });
    }

    const stripeCustomerId = await getStripeCustomerId(session.user.id);
    if (!stripeCustomerId) {
      throw redirect({ to: '/' });
    }
    …
  },
);
```

The identity Stripe is keyed on is the app's own principal id — the same id
`protectedProcedure` gates on, because both come off the resolved session
(ADR 0034).

### 4. `import 'server-only'`

`src/index.ts` starts with `import 'server-only'`, so every mount point above is
a server file. A worker reaching it needs
`tsx --conditions=react-server` (see `@acme/queue`'s `ADAPTER.md`).

## Env

Factory: `src/env.ts`, exported as `@acme/subscriptions/env`.

| Key             | Kind   | Notes                                                                                                                                                    |
| --------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CREDIT_LIMITS` | config | authored `{ Basic: 250, Standard: 350, Pro: 1600 }`; a record, so it goes through `jsonEnv` and is overridden **whole** (`CREDIT_LIMITS='{"Basic":10}'`) |
| `DEFAULT_LIMIT` | config | authored `250` — the unmapped-tier fallback                                                                                                              |

No secrets. The Stripe plan ids live in `@acme/billing`'s env and arrive as an
injected `PlanIds`, so this slice never reads them.

## Infra

`acme.infra: ["redis"]` → the `redis` profile in `deploy/compose.yaml`. The
Credit ledger and the subscription cache are Redis keys, namespaced per app by
`@acme/redis`'s `nsKey`.

## Also mount

`@acme/entitlements` (the interface this implements), `@acme/redis`,
`@acme/logger`, `@acme/env`. Its `PlanIds` argument is normally produced by
`@acme/billing`'s `toPlanIds`, so in practice this package is mounted alongside
`@acme/billing`.
