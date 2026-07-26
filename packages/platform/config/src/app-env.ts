import { z } from 'zod/v4';

import { ConfigValidationError } from './errors';

/**
 * `APP_ENV` — the deploy-target selector that picks a config profile. A closed
 * set with `development` as the base (ADR 0026 §3); orthogonal to `NODE_ENV`
 * (which can't express `staging`) and to `NEXT_PUBLIC_WEBAPP` (app identity).
 */
export const APP_ENVS = ['development', 'staging', 'production'] as const;

export const appEnvSchema = z.enum(APP_ENVS);

export type AppEnv = (typeof APP_ENVS)[number];

/**
 * Resolve the raw `process.env.APP_ENV` string (read once at the app's edge)
 * into a validated `AppEnv`. Unset/empty → `development` (dev-is-base, keeps
 * local + test runs ergonomic); an unknown value throws (ADR 0026 §5) — a typo
 * like `prod` must fail loud, since a silent degrade would bake the development
 * profile into a staging/production bundle.
 */
export function resolveAppEnv(raw: string | undefined) {
  if (raw === undefined || raw === '') return 'development' satisfies AppEnv;
  const result = appEnvSchema.safeParse(raw);
  if (!result.success) throw new ConfigValidationError(result.error);
  return result.data;
}
