/**
 * `@acme/config` — config-as-code (ADR 0026). A `createConfig` factory shaped
 * like `@t3-oss/env`'s `createEnv`, adding profile layering: each slice authors
 * a `config.ts` with `server`/`client` zod shapes and `development | staging |
 * production` profiles, and the app composes them once at its edge with
 * `configExtends`, threading the `APP_ENV`-derived context.
 *
 * Config is pure (never reads `process.env`/`NODE_ENV`) and always validates.
 *
 * Every non-sensitive value is also **overridable by an environment variable of
 * the same name** (nested via `__`) — at runtime for server config, at build
 * time for client config (ADR 0033). The bag is read at the sanctioned `env.ts`
 * edge and threaded in through the same context, so purity is unchanged.
 */
export {
  appConfigContext,
  createConfig,
  configExtends,
  describeConfig,
  serverConfigContext,
} from './create-config';
export type { ConfigContext } from './create-config';
export { clientOverrideBuildEnv } from './build-env';
export { coercedBoolean } from './coerce';
export {
  CLIENT_OVERRIDES_VAR,
  OVERRIDE_SEPARATOR,
  isCoercionTolerant,
  readClientOverrides,
} from './overrides';
export type { ConfigOverrides, OverrideBag } from './overrides';
export { isServer } from './runtime';
export { resolveAppEnv, appEnvSchema, APP_ENVS } from './app-env';
export type { AppEnv } from './app-env';
export { ConfigValidationError } from './errors';
