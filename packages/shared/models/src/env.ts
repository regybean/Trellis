import { resolveAppEnv } from '@acme/config';

/**
 * The config-as-code deploy-target selector (ADR 0026), resolved at this slice's
 * sanctioned `process.env` edge and threaded into `modelsConfig` where the slice
 * builds its config server-side (`resolve.ts` + the provider factories). Mirrors
 * the app's `env.ts` read; keeps `config.ts` pure.
 *
 * `@acme/models` has no non-secret env left: provider selection, model ids,
 * region and base URL are all config-as-code now (`config.ts`); the raw
 * credentials live in `env-providers.ts`, validated lazily by the selected
 * provider's factory.
 */
export const appEnv = resolveAppEnv(process.env.APP_ENV);
