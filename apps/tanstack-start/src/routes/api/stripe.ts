import { createFileRoute } from '@tanstack/react-router';

import { getStripe, processEvent, tryCatch } from '@acme/billing/server';

import { env } from '~/env';

// Stripe webhook — mirrors the Next.js route, reusing the neutral billing
// server helpers. Verifies the signature, then processes the event.
const handler = async (req: Request) => {
  const body = await req.text();
  const signature = req.headers.get('Stripe-Signature');

  if (!signature) {
    return Response.json({ error: 'Missing signature' }, { status: 400 });
  }

  const { error } = await tryCatch(async () => {
    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
    await processEvent(event);
  });

  if (error) {
    console.error('[STRIPE HOOK] Error processing event', error);
  }

  return Response.json({ received: true });
};

export const Route = createFileRoute('/api/stripe')({
  server: { handlers: { POST: ({ request }) => handler(request) } },
});
