import { merge } from 'ts-deepmerge';
import { z } from 'zod/v4';

import type { AppEnv } from './app-env';
import { ConfigValidationError } from './errors';

/**
 * The injected purity seam (ADR 0026 §4). Config never reads `process.env` or
 * `NODE_ENV`; the deploy target (`appEnv`) and the runtime side (`isServer`)
 * arrive here, resolved once at the app's composition edge. Tests construct a
 * context directly — `{ appEnv: 'staging', isServer: true }` — with no env.
 */
export interface ConfigContext {
  appEnv: AppEnv;
  isServer: boolean;
}

type ZodShape = Record<string, z.ZodType>;

/** The validated (post-coercion) value type of a single zod shape. */
type ShapeOutput<T extends ZodShape> = {
  readonly [K in keyof T]: z.output<T[K]>;
};

/**
 * The public shape of a config object: the client keys, plus the server keys
 * (present in the type in every context — the client guard enforces at runtime
 * that server keys aren't *read* on the client).
 */
type ConfigOutput<
  TServer extends ZodShape,
  TClient extends ZodShape,
> = ShapeOutput<TClient> & ShapeOutput<TServer>;

/**
 * A profile's raw values, typed against the *input* of each shape's schema so a
 * wrong literal is a compile error, not just a runtime one (the ADR's
 * authoring-time-safety sub-decision). Every key is optional here: the base
 * (`default`) supplies the full set and overlays patch a subset; runtime zod
 * validation is what enforces the base is actually complete.
 */
interface ProfileValues<TServer extends ZodShape, TClient extends ZodShape> {
  server?: Partial<{ [K in keyof TServer]: z.input<TServer[K]> }>;
  client?: Partial<{ [K in keyof TClient]: z.input<TClient[K]> }>;
}

/**
 * The closed profile set (ADR 0026 §3): `default` *is* `development`; `staging`
 * and `production` are optional overlays merged over it.
 */
interface Profiles<TServer extends ZodShape, TClient extends ZodShape> {
  default: ProfileValues<TServer, TClient>;
  staging?: ProfileValues<TServer, TClient>;
  production?: ProfileValues<TServer, TClient>;
}

interface CreateConfigOptions<
  TServer extends ZodShape,
  TClient extends ZodShape,
> {
  server?: TServer;
  client?: TClient;
  profiles: Profiles<TServer, TClient>;
  context: ConfigContext;
}

/**
 * Internal handle attached to every guarded config under a well-known symbol so
 * `configExtends` can merge configs without tripping the client access guard
 * (spreading a guarded object would read — and throw on — server keys). Not part
 * of any config's public type; reached only through `readInternal`.
 */
const CONFIG_INTERNAL = Symbol.for('acme.config.internal');

interface ConfigInternal {
  values: Record<string, unknown>;
  serverKeys: ReadonlySet<string>;
  isServer: boolean;
}

function isConfigInternal(value: unknown): value is ConfigInternal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'values' in value &&
    'serverKeys' in value
  );
}

function readInternal(config: object) {
  const value: unknown = Reflect.get(config, CONFIG_INTERNAL);
  return isConfigInternal(value) ? value : undefined;
}

/**
 * Wrap a validated value object so that reading a server-only key on the client
 * throws loudly (the ADR's client-guard sub-decision, resolved in favour of a
 * throwing Proxy over silent omission — a uniform return type and a loud
 * failure beat a quietly-`undefined` value). On the server it is a transparent
 * read-only view. Both expose the internal handle under `CONFIG_INTERNAL`.
 */
function guard<T>(
  values: Record<string, unknown>,
  serverKeys: ReadonlySet<string>,
  isServer: boolean,
) {
  const internal: ConfigInternal = { values, serverKeys, isServer };
  const proxy = new Proxy(values, {
    get(target, prop, receiver) {
      if (prop === CONFIG_INTERNAL) return internal;
      if (!isServer && typeof prop === 'string' && serverKeys.has(prop)) {
        throw new Error(
          `Config key "${prop}" is server-only and was read on the client. ` +
            `Read it in server code, or move it to the \`client\` shape if it is browser-safe.`,
        );
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return value;
    },
    set(_target, prop) {
      throw new Error(`Config is read-only; cannot assign "${String(prop)}".`);
    },
  });
  // The Proxy erases the precise shape of `values`; the caller knows it from the
  // parsed zod outputs. This is the single type-boundary assertion in the
  // package — every read through the returned object stays type-checked.
  return proxy as T;
}

function validate<T extends ZodShape>(shape: T, values: unknown) {
  const result = z.object(shape).safeParse(values);
  if (!result.success) throw new ConfigValidationError(result.error);
  return result.data;
}

/**
 * Build a slice's config: deep-merge the `APP_ENV`-selected profile over
 * `default`, validate the merged result through the `server`/`client` zod
 * shapes (coercion runs on the merge), and return a guarded object.
 *
 * Arrays *replace* rather than concatenate (`mergeArrays: false`) — an overlay
 * that sets a list means "use this list", not "append to the base's" (the ADR's
 * array-merge sub-decision).
 *
 * Config *always* validates, in every context — it is never gated by
 * `shouldSkipEnvValidation()` (ADR 0026 §6): its values come from code, so the
 * missing-var failure env's skip guards against cannot occur, and build is
 * exactly when client config must validate before the bundle freezes.
 */
export function createConfig<
  TServer extends ZodShape = Record<never, never>,
  TClient extends ZodShape = Record<never, never>,
>(options: CreateConfigOptions<TServer, TClient>) {
  const { profiles, context } = options;

  const overlay =
    context.appEnv === 'development' ? {} : (profiles[context.appEnv] ?? {});
  const merged = merge.withOptions(
    { mergeArrays: false },
    profiles.default,
    overlay,
  );

  const serverValues = options.server
    ? validate(options.server, merged.server ?? {})
    : {};
  const clientValues = options.client
    ? validate(options.client, merged.client ?? {})
    : {};
  const combined = { ...clientValues, ...serverValues };
  const serverKeys = new Set(Object.keys(options.server ?? {}));

  return guard<ConfigOutput<TServer, TClient>>(
    combined,
    serverKeys,
    context.isServer,
  );
}

type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

/** The merged output of a `configExtends` list — `{}` for the empty edge. */
type MergeConfigs<T extends readonly object[]> = T extends readonly []
  ? Record<string, never>
  : UnionToIntersection<T[number]>;

/**
 * Compose several slice configs into one flat object at the app's edge —
 * `configExtends([authConfig(ctx), billingConfig(ctx)])` — mirroring `env.ts`'s
 * `extends: [chatEnv(), ingestEnv()]`. Each slice resolves the same `context`
 * (the app reads `APP_ENV` once and threads it), so the merged object carries a
 * single client guard spanning every slice's server keys.
 */
export function configExtends<T extends readonly object[]>(configs: [...T]) {
  const values: Record<string, unknown> = {};
  const serverKeys = new Set<string>();
  let isServer = true;

  for (const config of configs) {
    const internal = readInternal(config);
    if (!internal) {
      throw new Error(
        'configExtends: every argument must be a config built by createConfig.',
      );
    }
    Object.assign(values, internal.values);
    for (const key of internal.serverKeys) serverKeys.add(key);
    isServer = internal.isServer;
  }

  return guard<MergeConfigs<T>>(values, serverKeys, isServer);
}
