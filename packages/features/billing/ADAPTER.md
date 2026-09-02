# Mounting `@acme/billing`

The heaviest mount in the repo: two routes (tRPC plus the Stripe webhook), two
providers, a pricing page, a post-checkout page, and an env factory carrying the
only real secrets a full app needs. It also supplies the plan ids that
`@acme/subscriptions` turns into the app's `EntitlementsProvider`, so mounting
billing is what gives the app tiers and credits at all.

Note the export split: `./server` is framework-neutral (no `next` imports, safe
under Nitro), `./server-next` holds the one Next-only RSC.

## Mounted by

- `apps/nextjs` — `src/app/api/trpc/billing/[trpc]/route.ts`,
  `src/app/api/stripe/route.ts`, `src/app/layout.tsx`, `src/app/pricing/page.tsx`,
  `src/app/stripe/success/page.tsx`, `src/app/chat-assistant/chat-view.tsx`,
  `src/components/admin/admin-dashboard.tsx`, `src/server/trpc-route.ts`,
  `src/env.ts`, `worker.ts`
- `apps/tanstack-start` — `src/routes/api/trpc/billing.$.ts`,
  `src/routes/api/stripe.ts`, `src/routes/__root.tsx`, `src/routes/pricing.tsx`,
  `src/components/stripe/stripe-success.tsx`, `src/components/chat-view.tsx`,
  `src/lib/stripe.ts`, `src/lib/trpc-context.ts`, `src/env.ts`, `worker.ts`

The slim apps mount none of it. Dropping Stripe from the graph is half of what
the `*-slim` apps exist to prove (ADR 0010).

## Glue

### 1. The tRPC route — `apps/nextjs/src/app/api/trpc/billing/[trpc]/route.ts`

```ts
import { appRouter, createTRPCContext } from '@acme/billing/server';

import { createTRPCRouteHandlers } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/billing',
  router: appRouter,
  createContext: createTRPCContext,
});
```

The context resolver must thread `origin` (see `@acme/trpc`'s `ADAPTER.md`) —
billing combines it with the config-owned checkout paths to build absolute Stripe
redirect URLs. It is the one feature that needs it, which is why the field is
optional for everyone else.

### 2. The Stripe webhook — `apps/nextjs/src/app/api/stripe/route.ts`

```ts
import { getStripe, processEvent, tryCatch } from '@acme/billing/server';
import { logger } from '@acme/logger';

import { env } from '~/env';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get('Stripe-Signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  async function doEventProcessing() {
    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
    await processEvent(event);
  }

  const { error } = await tryCatch(doEventProcessing);

  if (error) {
    logger.error({ error }, 'stripe webhook processing failed');
  }

  return NextResponse.json({ received: true });
}
```

`apps/tanstack-start/src/routes/api/stripe.ts` is the same body behind a
`createFileRoute('/api/stripe')`.

Three things a copy must keep: read the **raw text** body before parsing
(signature verification needs the exact bytes), always return `200` even on a
processing failure (Stripe retries otherwise), and keep this path out of any
signed-in guard — it is a legitimate cross-origin POST with no session. In the
Next app it is in `PUBLIC_EXACT` in `src/middleware.ts`; in the TanStack app the
CSRF middleware is scoped to `handlerType === 'serverFn'` so it leaves this route
alone.

### 3. The two providers — `apps/nextjs/src/app/layout.tsx`

```tsx
import { BillingConfigProvider, BillingTRPCProvider } from '@acme/billing';
import {
  env as billingEnvValues,
  toBillingClientConfig,
} from '@acme/billing/env';
// Server-derived from the Stripe connection (billing env, ADR 0033); threaded to
// the client through the BillingConfigProvider seam so the client never proxies
// billing mode through NODE_ENV.
import { localstripeMode } from '@acme/billing/server';

<BillingConfigProvider
  config={toBillingClientConfig(billingEnvValues)}
  localstripeMode={localstripeMode}
>
  <AppQueryClientProvider>
    <BillingTRPCProvider>
      …
```

`toBillingClientConfig` is not optional tidying. Passing the whole env object as
a client-component prop would Flight-serialize the **server** keys into the
browser payload — serialization runs on the server, where the access guard cannot
fire. The picker keeps only the browser-safe keys.

`BillingTRPCProvider` takes no `scopeKey` — billing has no persister. It must sit
below the app's QueryClient and **below** the app's `AuthStatusProvider`, because
it gates viewer-scoped queries on the neutral `AuthStatus` from `@acme/hooks`.

On TanStack Start `localstripeMode` cannot be imported into the client tree
directly; it comes through a server function
(`apps/tanstack-start/src/lib/stripe.ts`) and the root route's `beforeLoad`.

### 4. The pricing page — `apps/nextjs/src/app/pricing/page.tsx`

```tsx
import { PricingPage } from '@acme/billing';

export default function Page() {
  return (
    <div className="bg-muted min-h-screen flex-grow p-5">
      <PricingPage />
    </div>
  );
}
```

### 5. Post-checkout — `apps/nextjs/src/app/stripe/success/page.tsx`

```tsx
import { StripeSuccessLoading, StripeSuccessRedirect } from '@acme/billing';
import { StripeSuccessHandler } from '@acme/billing/server-next';

import { auth } from '~/server/auth';

export default async function StripeProcessingPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect('/sign-in?redirect=/stripe/success');
  }

  return (
    <Suspense fallback={<StripeSuccessLoading />}>
      <StripeSuccessHandler userId={session.user.id} />
    </Suspense>
  );
}
```

`StripeSuccessHandler` takes the id rather than reaching for an auth provider —
auth is app-owned (ADR 0003). TanStack Start cannot use that RSC, so it rebuilds
the same flow from the neutral `syncStripeDataToKV` in `src/lib/stripe.ts` and its
own `StripeSuccessRedirect` in `src/components/stripe/stripe-success.tsx`. Two
framework halves over one neutral helper — worth diffing if you are porting to a
third runtime.

### 6. Plan ids → entitlements — `apps/nextjs/src/server/trpc-route.ts`

```ts
import { env as billingEnv, toPlanIds } from '@acme/billing/env';
import { createSubscriptionsEntitlements } from '@acme/subscriptions';

const entitlements = createSubscriptionsEntitlements(toPlanIds(billingEnv));
```

Every edge that needs the product→tier mapping goes through `toPlanIds` — the
route handler, the tRPC context, the workers and `usePricing`. Adding a plan
touches that one mapper.

### 7. Credit invalidation is the app's wiring — `apps/nextjs/src/app/chat-assistant/chat-view.tsx`

```tsx
const billingTrpc = useBillingTRPC();

const handleTokensConsumed = () => {
  void queryClient.invalidateQueries(
    billingTrpc.account.getCreditUsage.pathFilter(),
  );
};
```

`@acme/chat` fires a callback; the app decides that it means "refresh the credit
balance". Neither feature knows about the other.

### 8. Compose the env — `apps/nextjs/src/env.ts`

```ts
import { billingEnv } from '@acme/billing/env';

export const env = createEnv({
  extends: [chatEnv(), ingestEnv(), billingEnv(), betterAuthEnv()],
  …
});
```

## Env

Factory: `src/env.ts`, exported as `@acme/billing/env` (`billingEnv()`).

**`shared`** — browser-safe, read on both sides, threaded through
`BillingConfigProvider` / `useBillingConfig`:

| Key                         | Kind   | Development value                               |
| --------------------------- | ------ | ----------------------------------------------- |
| `STRIPE_STANDARD_PLAN_ID`   | config | `prod_dev_standard`                             |
| `STRIPE_PRO_PLAN_ID`        | config | `prod_dev_pro`                                  |
| `STRIPE_PUBLISHABLE_KEY`    | config | `pk_test_localstripe` (publishable, not secret) |
| `STRIPE_MANAGE_BILLING_URL` | config | `http://localhost:3000/billing`                 |

**`server`** — read only at billing's server edges:

| Key                            | Kind            | Development value                                                                                                          |
| ------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_CONNECTION`            | config          | `{ mode: 'localstripe', apiBase: 'http://localhost:8420' }`; a discriminated union through `jsonEnv`, overridden **whole** |
| `STRIPE_CHECKOUT_SUCCESS_PATH` | config          | `/billing?success=true`                                                                                                    |
| `STRIPE_CHECKOUT_CANCEL_PATH`  | config          | `/billing?canceled=true`                                                                                                   |
| `STRIPE_SECRET_KEY`            | config → secret | `sk_test_localstripe` in development; **unauthored** on staging/production                                                 |
| `STRIPE_WEBHOOK_SECRET`        | config → secret | `whsec_localstripe` in development; unauthored on staging/production                                                       |

The two secrets are localstripe's fixed placeholders locally — documented as not
real secrets and gitleaks-allowlisted (ADR 0004) — so a clean checkout runs
billing against the fake server with no `.env` rows. The staging/production
overlays unauthor them, which makes them demanded there by the same mechanical
rule as every other secret.

`STRIPE_CONNECTION` being a union is load-bearing: `apiBase` exists **only** in
`localstripe` mode, so a production build cannot hold a stray localhost address —
an overlay of `{ mode: 'real' }` deep-merges onto the inherited localstripe
variant and zod's object-strip removes the inherited `apiBase` at parse time.

Client-side reads come from **this** slice's env, not the app's composed one:
t3-env's access guard is name-based and consults the reading call's `shared`
dict, which the app declares none of.

## Infra

`acme.infra: ["postgres", "billing"]`:

- **postgres** → the `postgres` profile in `deploy/compose.yaml`.
- **billing** → the `localstripe` service (`adrienverge/localstripe:1.15.10`,
  published on `8420`) — a fake stateful Stripe server, no real account or network
  (ADR 0004). `scripts/resolve-infra.ts` drops this profile unless the **authored**
  development `STRIPE_CONNECTION` is `localstripe`, so pointing development at a
  real Stripe account removes the container from the stack with no compose edit.

This package's own `scripts/seed-localstripe.ts` populates it with the authored
plan ids.

Redis arrives transitively through `@acme/subscriptions` (the Credit ledger and
subscription cache).

## Also mount

`@acme/subscriptions` (turns `toPlanIds` into the entitlements provider),
`@acme/auth` (the app resolves the principal Stripe is keyed on),
`@acme/trpc`, `@acme/hooks`, `@acme/ui`, `@acme/entitlements`, `@acme/db`,
`@acme/redis`, `@acme/telemetry`, `@acme/logger`, `@acme/env`. `stripe` is this
package's dependency, so an app imports it only where it needs the SDK types.
