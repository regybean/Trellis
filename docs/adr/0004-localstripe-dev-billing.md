# localstripe for dependency-free local-dev billing

Local development runs billing against [localstripe](https://github.com/adrienverge/localstripe)
— a fake, stateful Stripe server — instead of the real Stripe API. It is the
**default** dev configuration: a fresh `.env` (copied from `.env.example`) points
at localstripe, so a new developer gets working billing with no Stripe account,
no API keys, and no network. Five decisions are load-bearing:

1. **Backend/subscription-state correctness only — no hosted Stripe UI.** We do
   not reproduce Stripe-hosted Checkout or the Billing Portal. localstripe serves
   the API; the parts of the app that depend on Stripe's hosted pages
   (`createCheckoutSession`, `createDashboardSession`) are not the dev path.
   Instead, paid tiers are granted on demand from the **admin page**
   (`TierManagement` → `account.setUserTier`), which creates/cancels
   subscriptions directly via the API.
2. **The SDK is retargeted by env, not forked.** When `STRIPE_API_BASE` is set,
   `getStripe()` parses it into the `host`/`port`/`protocol` overrides the Stripe
   Node SDK already supports. Unset (prod/CI) → the SDK's real defaults are
   untouched. Every localstripe-only branch keys off `STRIPE_API_BASE`, so the
   real-Stripe path is unchanged when it is absent.
3. **Legacy Plans fallback — localstripe predates the Prices API.** localstripe
   models the deprecated **Plans** API: subscription items carry `plan`, not
   `price`; there is no `/v1/prices`, no `default_price`, and no
   `default_payment_method` on subscriptions. Expanding `data.items.data.price`
   or `data.default_payment_method` **400s**. So `buildSubscriptionCache` reads
   `price ?? plan` (preferring the modern shape, which real Stripe always
   returns), and `syncStripeDataToKV` skips those expands when
   `STRIPE_API_BASE` is set. `getSubscriptionType` still compares the
   subscription's **product** against the env plan IDs, so the seeded plans
   reference products whose IDs match `NEXT_PUBLIC_STRIPE_{STANDARD,PRO}_PLAN_ID`.
4. **Seeded automatically, granted on demand.** `pnpm infra:up` brings up the
   `infra` compose profile, waits for the localstripe container to be healthy,
   then runs `seed:localstripe` (idempotent — localstripe state is in-memory, so
   it re-seeds on every start). The seed creates the two products + plans (with
   GBP amounts mirroring `pricing-data.ts`: Standard £30, Pro £80) and registers
   the webhook. Nothing user-specific is seeded; tiers are assigned per-user from
   the admin UI.
5. **Webhooks run in dev.** The seed registers a localstripe webhook
   (`POST /_config/webhooks/...`) pointing at the app's `/api/stripe` handler via
   `host.docker.internal`, signed with `STRIPE_WEBHOOK_SECRET`. `setUserTier`
   *also* calls `syncStripeDataToKV` directly so the admin UI updates
   deterministically without depending on webhook delivery timing.

## Status

accepted

## Considered and rejected

- **Stripe CLI + a real (test-mode) Stripe account.** Needs an account, API keys,
  and network; each developer configures their own. localstripe needs none of
  that and is the lower-friction default. Rejected for the default dev path
  (real Stripe is still one env change away — unset `STRIPE_API_BASE` and
  `pnpm env:pull`).
- **Reproducing hosted Checkout / Billing Portal locally.** localstripe serves
  the API, not Stripe's hosted pages. Rebuilding them would be large and
  divergent from production. The admin grant action covers the only thing dev
  actually needs: putting a user on a tier. Rejected.
- **Teaching `buildSubscriptionCache` to read only `plan`.** That would break
  real Stripe, which returns `price`. Preferring `price ?? plan` keeps one code
  path correct against both. Rejected the localstripe-only shape.
- **Floating/`latest` image tag.** Pinned to `adrienverge/localstripe:1.15.10`
  for reproducibility.
- **`extra_hosts` for `host.docker.internal`.** Works out of the box on Docker
  Desktop (macOS/Windows). Deferred — add only if a Linux dev actually hits it.

## Consequences

- `STRIPE_API_BASE` (optional) is added to `@acme/billing` env and to turbo's
  `globalEnv` / `globalPassThroughEnv`. `.env.example` ships the localstripe
  defaults uncommented.
- New compose service `localstripe` (image pinned, `infra` profile, python3
  healthcheck — the base image has no curl/wget). `pnpm infra:up` is now a script
  (`scripts/infra-up.sh`) that seeds after the container is healthy.
- New `account.setUserTier` admin procedure + `setUserTier` util, guarded on
  `STRIPE_API_BASE` (throws `PRECONDITION_FAILED` against real Stripe). It cancels
  existing subscriptions first, then for a paid tier attaches localstripe's
  built-in `pm_card_visa` test card (→ 4242, makes the first invoice paid so the
  subscription goes `active`) and creates a subscription on the matching plan.
  New `TierManagement` admin component renders alongside `RateLimitManagement`.
- `.gitleaks.toml` allowlists the fixed localstripe placeholder tokens
  (`sk_test_localstripe`, `whsec_localstripe`, `pk_test_localstripe`) — they are
  not real secrets.
- **Known unknown (verify on first real `infra:up`, which is manual-only):** that
  attaching `pm_card_visa` + setting the customer default payment method does in
  fact transition a freshly created subscription to `active` in localstripe
  1.15.10, and that the seeded plan/product wiring round-trips through
  `getSubscriptionType` to the expected tier.
