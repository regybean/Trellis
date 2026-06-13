import type { NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { getStripe, processEvent, tryCatch } from '@acme/billing/server';

import { env } from '~/env';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get('Stripe-Signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  async function doEventProcessing() {
    if (typeof signature !== 'string') {
      throw new TypeError("[STRIPE HOOK] Header isn't a string???");
    }
    const stripe = getStripe();

    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );

    // Use the processEvent function from our stripe utilities
    await processEvent(event);
  }

  const { error } = await tryCatch(doEventProcessing);

  if (error) {
    console.error('[STRIPE HOOK] Error processing event', error);
  }

  return NextResponse.json({ received: true });
}
