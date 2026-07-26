/**
 * `@acme/config` — config-as-code (ADR 0026). A `createConfig` factory shaped
 * like `@t3-oss/env`'s `createEnv`, adding profile layering: each slice authors
 * a `config.ts` with `server`/`client` zod shapes and `development | staging |
 * production` profiles, and the app composes them once at its edge with
 * `configExtends`, threading the `APP_ENV`-derived context.
 *
 * Config is pure (never reads `process.env`/`NODE_ENV`) and always validates.
 */
export { createConfig, configExtends } from './create-config';
export type { ConfigContext } from './create-config';
export { resolveAppEnv, appEnvSchema, APP_ENVS } from './app-env';
export type { AppEnv } from './app-env';
export { ConfigValidationError } from './errors';
