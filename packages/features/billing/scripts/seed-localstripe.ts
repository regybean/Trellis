/* eslint-disable no-restricted-syntax */
/**
 * Seed the local `localstripe` server with the products/plans and webhook the
 * app expects, so dev billing works with no real Stripe account or network.
 *
 * Idempotent: safe to run on every `pnpm infra:up`. localstripe state is
 * in-memory, so it must run after each localstripe (re)start.
 *
 * Run via `pnpm --filter @acme/billing seed:localstripe` (wired into infra:up).
 * No-ops when the Stripe connection config resolves to `real` Stripe.
 *
 * The products and plans themselves come from `seedLocalstripePlans`
 * (`src/testing.ts`), shared with the backend suite that seeds its own
 * throwaway container — so the plan table has one definition. What stays here
 * is what only a dev stack has: the env-derived connection, and a webhook
 * pointing at a running app.
 *
 * Note: localstripe predates Stripe's Prices API — it models the legacy Plans
 * API. We seed Products + Plans (not Prices); the app reads the deprecated
 * `plan` shape via buildSubscriptionCache. See docs/adr/0003.
 */
import Stripe from 'stripe';

import { env, toPlanIds } from '../src/env';
import { seedLocalstripePlans } from '../src/testing';

// The Stripe connection is authored config: localstripe (dev) carries the
// `apiBase`; real Stripe carries none and needs no seeding. Read off the
// slice's own env, so seeding follows a `STRIPE_CONNECTION` override rather
// than the profile's value when one is set.
const connection = env.STRIPE_CONNECTION;
if (connection.mode === 'real') {
  console.log('Stripe connection is real — using real Stripe, skipping seed.');
  process.exit(0);
}

const apiBase = connection.apiBase;
const url = new URL(apiBase);
const isHttps = url.protocol === 'https:';
const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY ?? 'sk_test_localstripe',
  {
    httpClient: Stripe.createFetchHttpClient(),
    host: url.hostname,
    port: Number(url.port) || (isHttps ? 443 : 80),
    protocol: isHttps ? 'https' : 'http',
  },
);

async function registerWebhook() {
  // localstripe-only endpoint: it signs and delivers events to this URL using
  // `secret`. The URL is resolved from inside the localstripe container, hence
  // host.docker.internal (the host where Next.js runs).
  const webhookUrl =
    process.env.STRIPE_DEV_WEBHOOK_URL ??
    'http://host.docker.internal:3000/api/stripe';
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_localstripe';

  const res = await fetch(`${apiBase}/_config/webhooks/localstripe-dev`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ url: webhookUrl, secret }),
  });

  if (!res.ok) {
    throw new Error(
      `Failed to register localstripe webhook (${res.status}): ${await res.text()}`,
    );
  }
  console.log(`  webhook → ${webhookUrl}`);
}

async function main() {
  console.log(`Seeding localstripe at ${apiBase} …`);

  // The plan ids come from this slice's env through the one mapper, so the
  // seeded products are the ones getSubscriptionType will compare against.
  const seeded = await seedLocalstripePlans(stripe, toPlanIds(env));
  for (const plan of seeded) {
    console.log(
      `  ${plan.productName}: ${plan.productId} / ${plan.planId} (${plan.amount} gbp)`,
    );
  }

  await registerWebhook();
  console.log('localstripe seed complete.');
}

main().catch((error: unknown) => {
  console.error('localstripe seed failed:', error);
  process.exit(1);
});
