/**
 * Composition root — @acme/nextjs-slim.
 *
 * Everything this app injects into a seam is constructed here, once, and every
 * entry point imports the result: the tRPC route seam (`src/server/trpc-route.ts`)
 * and the generation worker (`worker.ts`).
 *
 * Two independently constructed providers both typecheck — TypeScript checks
 * that a mount naming `entitlements` gets one (#264), not that the worker and
 * the route seam got the *same* one. Confining construction to this file is
 * what makes them the same value (ADR 0006).
 *
 * This is also where the absence of Stripe from a slim app's graph is readable
 * rather than inferred from a missing dependency (ADR 0010): the choice is one
 * line, in one file, and `@acme/subscriptions` is nowhere in it.
 *
 * Built values only: no helpers, no re-exports. An ESLint override keeps the
 * providers out of every other file in this app.
 */

/**
 * The no-op entitlements provider — top tier, infinite credits, and a `refund`
 * that does nothing, because an app with no billing charged nothing. This app
 * strips billing but still mounts `@acme/chat`, which meters credits, so it is
 * choosing *unmetered* rather than declining to choose (ADR 0006, ADR 0010).
 *
 * Renamed to `entitlements` on the way out: entry points import what this app
 * injects, not which provider it happens to be.
 */
export { unlimitedEntitlements as entitlements } from '@acme/entitlements';
