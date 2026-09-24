# Mounting `@acme/billing`

Subscriptions through Stripe: a pricing page, a checkout round trip, a webhook,
and the plan ids that become entitlements. The most wiring of any slice, because
payment returns through your app rather than only through a request.

## What it gives you

- A pricing page and a subscription-details view, driven by the plans you
  configure.
- Checkout and cancellation flows, including the post-checkout landing state
  that waits for Stripe to confirm before showing a result.
- Plan ids mapped onto entitlements, so mounting this alongside
  `@acme/subscriptions` is what makes metered features meter for real.
- Admin views for tiers and rate limits, and a widget showing the current plan.
- A credit-balance row for your signed-in menu (`NavCreditBalance`), showing the
  viewer's plan and remaining credits. This package owns how it reads; you own
  where it sits ([ADR 0002](docs/adr/0002-credit-balance-display-belongs-to-billing.md)).
- A tRPC router and context factory, plus a webhook handler.

## Surface

| Import                      | What's in it                                  | Runs   |
| --------------------------- | --------------------------------------------- | ------ |
| `@acme/billing`             | Pricing page, checkout views, admin, provider | client |
| `@acme/billing/server`      | Router, context factory, webhook handling     | server |
| `@acme/billing/server-next` | The post-checkout handler for server renders  | server |
| `@acme/billing/env`         | This package's env factory                    | either |

`./server-next` exists because one component has to run during a server render,
to read the checkout result before painting. Another framework uses `./server`
and renders that result its own way.

## Wiring

- Mount the router and the provider —
  [trpc-route.md](../../../docs/mounting/trpc-route.md),
  [provider.md](../../../docs/mounting/provider.md).
- Mount the **webhook** as its own route, outside the tRPC seam. Stripe posts a
  signed body to it, so it needs the raw request and no session.
- Pass `PricingPage` an `adminPath` only when the viewer may follow it. The
  dev-mode banner links there to set a tier, and this package cannot see who is
  viewing, so an unconditional link sends non-admins to a page that rejects them.
- Give it three pages of yours: pricing, checkout success and checkout cancel.
  The success and cancel paths are configured values, so they must match the
  routes you actually created — [ui.md](../../../docs/mounting/ui.md).
- Build the entitlements provider from this package's plan ids and inject it in
  your route seam and your worker — see
  [`@acme/subscriptions`](../../platform/subscriptions/ADAPTER.md).
- Compose the env factory ([env.md](../../../docs/mounting/env.md)), and
  invalidate your credit display after any metered action — this feature does
  not know which others meter, so your page connects them.

## Env

| Key                     | Class           | What it's for                  |
| ----------------------- | --------------- | ------------------------------ |
| `STRIPE_SECRET_KEY`     | config → secret | Server-side Stripe API access  |
| `STRIPE_WEBHOOK_SECRET` | config → secret | Verifies the webhook signature |

Both are authored for the local Stripe stand-in in development and removed on
staging and production, so a real deploy must supply them. Plus seven
profile-authored keys: the plan ids, the publishable key, the manage-billing URL,
the checkout return paths and the connection selector. See `src/env.ts`.

## Infra

`postgres` for the customer mapping. The local Stripe stand-in is needed only
while the connection selects it — point at real Stripe and it drops out
([infra.md](../../../docs/mounting/infra.md),
[ADR 0001](docs/adr/0001-localstripe-dev-billing.md)).
