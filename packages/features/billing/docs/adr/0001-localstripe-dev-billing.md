# localstripe for dependency-free local-dev billing

**Status:** accepted

Local development runs billing against [localstripe](https://github.com/adrienverge/localstripe)
— a fake, stateful Stripe server — instead of the real Stripe API. It is the
**default** dev configuration: the development profile authors the localstripe
connection in code, so a clean checkout gets working billing with no Stripe
account, no API keys, no `.env` rows and no network. Five decisions are
load-bearing:

1. **Backend/subscription-state correctness only — no hosted Stripe UI.** We do
   not reproduce Stripe-hosted Checkout or the Billing Portal. localstripe serves
   the API; the parts of the app that depend on Stripe's hosted pages
   (`createCheckoutSession`, `createDashboardSession`) are not the dev path.
   Instead, paid tiers are granted on demand from the **admin page**
   (`TierManagement` → `account.setUserTier`), which creates/cancels
   subscriptions directly via the API. The pricing CTA is _disabled_ in
   localstripe mode rather than left to fail on a page that doesn't exist —
   which is why the mode has to reach the browser at all. It is threaded through
   `BillingConfigProvider`, so `usePricing` reads one server-derived boolean
   instead of inferring dev-ness from `NODE_ENV` (a real-Stripe dev build would
   misclassify).
2. **The SDK is retargeted by config, not forked.** In `localstripe` mode
   `getStripe()` parses the connection's `apiBase` into the `host`/`port`/
   `protocol` overrides the Stripe Node SDK already supports; in `real` mode the
   SDK's defaults are untouched. Every localstripe-only branch keys off a single
   boolean — `localstripeMode`, derived once in `stripe-client.ts` as
   `stripe.mode === 'localstripe'` — so the real-Stripe path is unchanged.
   (Originally an `STRIPE_API_BASE` env carve-out; migrated in #146 to
   `STRIPE_CONNECTION`, the discriminated union in `src/env.ts` that keeps
   `apiBase` off the `real` variant entirely, so a staging or production build
   can never hold a stray localhost address.)
3. **Legacy Plans fallback — localstripe predates the Prices API.** localstripe
   models the deprecated **Plans** API: subscription items carry `plan`, not
   `price`; there is no `/v1/prices`, no `default_price`, and no
   `default_payment_method` on subscriptions. Expanding `data.items.data.price`
   or `data.default_payment_method` **400s**. So `syncStripeDataToKV` skips those
   expands in localstripe mode, and `buildSubscriptionCache` reads `price ?? plan`
   — shape-tolerant rather than mode-gated, preferring the modern shape real
   Stripe always returns, so one cache builder stays correct against both
   servers. `getSubscriptionType` still compares the subscription's **product**
   against the injected plan ids, so the seeded plans must reference products
   whose IDs match `STRIPE_STANDARD_PLAN_ID` / `STRIPE_PRO_PLAN_ID`.
4. **Seeded automatically, granted on demand.** `pnpm infra:up` brings up the
   compose profiles the dependency graph asks for — `billing` among them, because
   this package declares it in `acme.infra` ([ADR 0009](../../../../../docs/adr/0009-graph-derived-dev-infra.md))
   — waits for the localstripe container to be healthy, then runs
   `seed:localstripe` (idempotent — localstripe state is in-memory, so it
   re-seeds on every start). The seed creates the two products + plans (with GBP
   amounts mirroring `pricing-data.ts`: Standard £30, Pro £80) and registers the
   webhook. Nothing user-specific is seeded; tiers are assigned per-user from the
   admin UI.
5. **Webhooks run in dev.** The seed registers a localstripe webhook
   (`POST /_config/webhooks/...`) pointing at the app's `/api/stripe` handler via
   `host.docker.internal`, signed with `STRIPE_WEBHOOK_SECRET`. One URL is
   registered, defaulting to the Next.js dev port and overridable with
   `STRIPE_DEV_WEBHOOK_URL`, so only one app receives deliveries at a time.
   `setUserTier` _also_ calls `syncStripeDataToKV` directly so the admin UI
   updates deterministically without depending on webhook delivery timing.

## Considered and rejected

- **Stripe CLI + a real (test-mode) Stripe account.** Needs an account, API keys,
  and network; each developer configures their own. localstripe needs none of
  that and is the lower-friction default. Rejected for the default dev path
  (real Stripe is still one switch away — run under the `staging` profile
  (`APP_ENV=staging`, which resolves the connection to `real`) and `pnpm env:pull`).
- **Reproducing hosted Checkout / Billing Portal locally.** localstripe serves
  the API, not Stripe's hosted pages. Rebuilding them would be large and
  divergent from production. The admin grant action covers the only thing dev
  actually needs: putting a user on a tier. Rejected.
- **Teaching `buildSubscriptionCache` to read only `plan`.** That would break
  real Stripe, which returns `price`. Preferring `price ?? plan` keeps one code
  path correct against both. Rejected the localstripe-only shape.
- **Gating the cache builder on `localstripeMode` too.** The mode gates what
  would otherwise 400 (the expands) and what must never reach real Stripe (the
  tier grant). Reading a field that is simply absent needs no mode: a fallback
  that tolerates both shapes cannot drift out of step with the connection.
  Rejected — the mode is for API-capability differences, not for shape.
- **Floating/`latest` image tag.** Pinned to `adrienverge/localstripe:1.15.10`
  for reproducibility.
- **`extra_hosts` for `host.docker.internal`.** Works out of the box on Docker
  Desktop (macOS/Windows). Deferred — add only if a Linux dev actually hits it.

## Consequences

- **The connection and both secrets are authored config, not environment.**
  `src/development-profile.ts` authors `STRIPE_CONNECTION`
  (`{ mode: 'localstripe', apiBase }`) plus localstripe's fixed placeholder
  `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`, so a clean checkout runs billing
  against the fake server with no environment at all
  ([@acme/env ADR 0001](../../../../platform/env/docs/adr/0001-one-env-factory-per-slice.md)).
  The staging and production overlays resolve the connection to `real` and
  **unauthor** the two secrets, which makes them demanded secrets on those
  targets by the same mechanical rule as every other secret; turbo's `globalEnv`
  carries only those two keys. (Originally an optional `STRIPE_API_BASE` in
  turbo's `globalEnv`/`globalPassThroughEnv`, with the localstripe defaults
  shipped uncommented in `.env.example`.)
- Because the connection is authored, `scripts/resolve-infra.ts` can read it
  _without_ an environment and drop the `billing` compose profile when the
  authored mode is `real` — real Stripe needs no local container.
- New compose service `localstripe` (image pinned, `billing` profile, python3
  healthcheck — the base image has no curl/wget). `pnpm infra:up` is a script
  (`scripts/infra-up.sh`) that seeds after the container is healthy.
- New `account.setUserTier` admin procedure + `setUserTier` util, guarded on
  `localstripeMode` (throws `PRECONDITION_FAILED` against real Stripe). It cancels
  existing subscriptions first, then for a paid tier attaches localstripe's
  built-in `pm_card_visa` test card (→ 4242, makes the first invoice paid so the
  subscription goes `active`) and creates a subscription on the matching plan,
  looked up by product through `plans.list` rather than by a hard-coded seed plan
  id. New `TierManagement` admin component renders alongside
  `RateLimitManagement`.
- `.gitleaks.toml` allowlists the fixed localstripe placeholder tokens
  (`sk_test_localstripe`, `whsec_localstripe`, `pk_test_localstripe`) — they are
  not real secrets.
- **Known unknown (verify on first real `infra:up`, which is manual-only):** that
  attaching `pm_card_visa` + setting the customer default payment method does in
  fact transition a freshly created subscription to `active` in localstripe
  1.15.10, and that the seeded plan/product wiring round-trips through
  `getSubscriptionType` to the expected tier.
