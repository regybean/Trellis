/**
 * The authored **development** profile for this slice's env, in a module that
 * executes no `createEnv` call.
 *
 * `env.ts` authors its `default` profile from this object, and
 * `scripts/resolve-compose-env.ts` reads it *without* an environment: it parses
 * the port out of the DSN to publish the local container, and provisioning wants
 * the authored value rather than an operator's override (@acme/env ADR 0001 §6). The port
 * is parsed rather than stored twice — a second field would be a drift source.
 */
export const REDIS_DEVELOPMENT_PROFILE = {
  REDIS_URL: 'redis://localhost:6379',
} as const;
