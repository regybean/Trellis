import 'server-only';

// Next.js-coupled server surface: the Stripe success handler is an RSC that
// uses `next/navigation` redirect + `@clerk/nextjs/server`. Kept out of
// `./server` so the neutral server surface stays portable. The TanStack Start
// app reimplements this flow with a server function over `syncStripeDataToKV`.
export { StripeSuccessHandler } from './components/stripe/stripe-success-handler';
