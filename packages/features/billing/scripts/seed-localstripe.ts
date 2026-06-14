/* eslint-disable no-restricted-syntax */
/**
 * Seed the local `localstripe` server with the products/plans and webhook the
 * app expects, so dev billing works with no real Stripe account or network.
 *
 * Idempotent: safe to run on every `pnpm infra:up`. localstripe state is
 * in-memory, so it must run after each localstripe (re)start.
 *
 * Run via `pnpm --filter @acme/billing seed:localstripe` (wired into infra:up).
 * No-ops when STRIPE_API_BASE is unset (i.e. when using real Stripe).
 *
 * Note: localstripe predates Stripe's Prices API — it models the legacy Plans
 * API. We seed Products + Plans (not Prices); the app reads the deprecated
 * `plan` shape via buildSubscriptionCache. See docs/adr/0003.
 */
import Stripe from 'stripe';

const apiBase = process.env.STRIPE_API_BASE;
if (!apiBase) {
  console.log('STRIPE_API_BASE not set — using real Stripe, skipping seed.');
  process.exit(0);
}

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

// Product IDs must match the env plan IDs — getSubscriptionType derives the
// tier by comparing the subscription's product against these.
const standardProduct =
  process.env.NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID ?? 'prod_dev_standard';
const proProduct = process.env.NEXT_PUBLIC_STRIPE_PRO_PLAN_ID ?? 'prod_dev_pro';

// Amounts (pence) mirror the pricing-data.ts display: Standard £30, Pro £80.
const plans = [
  {
    productId: standardProduct,
    productName: 'Standard',
    planId: 'price_dev_standard',
    amount: 3000,
  },
  {
    productId: proProduct,
    productName: 'Pro',
    planId: 'price_dev_pro',
    amount: 8000,
  },
];

async function ensureProduct(id: string, name: string) {
  try {
    return await stripe.products.retrieve(id);
  } catch {
    return await stripe.products.create({ id, name });
  }
}

async function ensurePlan(id: string, product: string, amount: number) {
  try {
    return await stripe.plans.retrieve(id);
  } catch {
    return await stripe.plans.create({
      id,
      product,
      amount,
      currency: 'gbp',
      interval: 'month',
    });
  }
}

async function registerWebhook() {
  // localstripe-only endpoint: it signs and delivers events to this URL using
  // `secret`. The URL is resolved from inside the localstripe container, hence
  // host.docker.internal (the host where Next.js runs).
  const webhookUrl =
    process.env.STRIPE_DEV_WEBHOOK_URL ??
    'http://host.docker.internal:3000/api/stripe';
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_localstripe';

  const res = await fetch(`${apiBase}/_config/webhooks/trellis-dev`, {
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

  for (const plan of plans) {
    await ensureProduct(plan.productId, plan.productName);
    await ensurePlan(plan.planId, plan.productId, plan.amount);
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
