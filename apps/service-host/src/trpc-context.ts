import type { InjectedAuth } from '@acme/trpc';
import { unlimitedEntitlements } from '@acme/entitlements';

/**
 * App-owned tRPC context resolver — copied from `apps/tanstack-slim`'s
 * `src/lib/trpc-route.ts`. This host strips Clerk + billing entirely (local /
 * demo scope), so it injects a single constant admin principal and the no-op
 * `unlimitedEntitlements` (top tier, infinite credits) in place of the Clerk
 * resolver and the subscriptions provider. See ADR 0003 / ADR 0006 / ADR 0010.
 */

/**
 * Constant local principal. Feature procedures still require a principal:
 * `@acme/chat` is `protectedProcedure` (scopes Mastra memory by a non-null
 * `userId`) and `@acme/ingest` is `adminProcedure` (gates on
 * `sessionClaims.metadata.role === 'admin'`). One fixed admin user covers both.
 * `user` is null — no retained feature reads `ctx.user`.
 */
const LOCAL_PRINCIPAL: InjectedAuth = {
  userId: 'local',
  sessionClaims: { metadata: { role: 'admin' } },
};

/**
 * Shape the neutral context input the feature `createTRPCContext` expects.
 */
export const resolveContext = (req: Request) => ({
  headers: req.headers,
  req,
  auth: LOCAL_PRINCIPAL,
  user: null,
  entitlements: unlimitedEntitlements,
});
