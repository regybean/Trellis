import type { AnyRouter } from '@trpc/server';

/**
 * The feature registry — the single map from a `FEATURE` env value to the
 * dynamic import of that feature's server seam plus the tRPC endpoint it mounts
 * on. Each feature's `/server` export is uniform: `{ appRouter, createTRPCContext }`
 * (ADR 0015 bounded exports). Adding a feature = one entry here.
 *
 * The import is deferred (a thunk) so booting the host only transpiles and
 * loads the ONE selected feature's server graph, never all three.
 */
interface FeatureServerModule {
  appRouter: AnyRouter;
  createTRPCContext: (input: never) => Promise<unknown>;
}

interface FeatureEntry {
  import: () => Promise<FeatureServerModule>;
  endpoint: string;
}

export const registry = {
  chat: {
    import: () => import('@acme/chat/server'),
    endpoint: '/api/trpc/chat',
  },
  ingest: {
    import: () => import('@acme/ingest/server'),
    endpoint: '/api/trpc/ingest',
  },
  feedback: {
    import: () => import('@acme/feedback/server'),
    endpoint: '/api/trpc/feedback',
  },
} satisfies Record<string, FeatureEntry>;

export type FeatureName = keyof typeof registry;

export const isFeatureName = (value: string): value is FeatureName =>
  value in registry;
