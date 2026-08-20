import { merge } from 'ts-deepmerge';
import { z } from 'zod/v4';

import type { AppEnv } from './app-env';
import type { ConfigOverrides, OverrideBag } from './overrides';
import { resolveAppEnv } from './app-env';
import { ConfigValidationError } from './errors';
import { applyOverrides, isCoercionTolerant, shapeLeaves } from './overrides';

/**
 * The injected purity seam (ADR 0026 §4). Config never reads `process.env` or
 * `NODE_ENV`; the deploy target (`appEnv`), the runtime side (`isServer`) and
 * the env `overrides` bag (ADR 0033) arrive here, resolved once at the app's
 * composition edge. Tests construct a context directly —
 * `{ appEnv: 'staging', isServer: true }` — with no env.
 *
 * `overrides` is optional: omit it and config resolves from profiles alone,
 * which is what every test and every context-less read wants.
 */
export interface ConfigContext {
  appEnv: AppEnv;
  isServer: boolean;
  overrides?: ConfigOverrides;
}

/**
 * The standard context for a **server** edge — an app's `env.ts`, or a slice
 * that consumes its own config server-side (`createDb()`, `resolve.ts`, a
 * worker). Hands the whole env bag over as the server override lane, so a
 * same-name variable retunes any server value at runtime (ADR 0033); nothing
 * outside the declared shape is ever read from it.
 *
 * A single helper rather than a literal at ~25 call sites: forgetting
 * `overrides` would silently make a slice's config un-overridable, and that is
 * not a failure any test would catch.
 */
export function serverConfigContext(env: OverrideBag): ConfigContext {
  return {
    appEnv: resolveAppEnv(env.APP_ENV),
    isServer: true,
    overrides: { server: env },
  };
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
  /** The declared shapes, kept so overrides can be introspected — see {@link describeConfig}. */
  serverShape: ZodShape;
  clientShape: ZodShape;
}

function isConfigInternal(value: unknown): value is ConfigInternal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'values' in value &&
    'serverKeys' in value &&
    'serverShape' in value
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
  serverShape: ZodShape,
  clientShape: ZodShape,
) {
  const internal: ConfigInternal = {
    values,
    serverKeys,
    isServer,
    serverShape,
    clientShape,
  };
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
 * `default`, layer the env overrides on top, validate the result through the
 * `server`/`client` zod shapes (coercion runs on the merge), and return a
 * guarded object. Precedence, override last (ADR 0033):
 *
 *   `default` → `APP_ENV` overlay → env override → validate
 *
 * Each lane sees only its own bag — the server bag can only reach `server`
 * paths, the client bag only `client` paths — which is what keeps runtime and
 * build-time sampling from crossing (see {@link ConfigOverrides}).
 *
 * Arrays *replace* rather than concatenate between profiles
 * (`mergeArrays: false`) — an overlay that sets a list means "use this list",
 * not "append to the base's" (the ADR 0026 array-merge sub-decision). The
 * override layer instead patches an array element **by position**; ADR 0033 §4
 * documents why the two layers differ.
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
    ? validate(
        options.server,
        applyOverrides(
          options.server,
          merged.server ?? {},
          context.overrides?.server,
        ),
      )
    : {};
  const clientValues = options.client
    ? validate(
        options.client,
        applyOverrides(
          options.client,
          merged.client ?? {},
          context.overrides?.client,
        ),
      )
    : {};
  const combined = { ...clientValues, ...serverValues };
  const serverKeys = new Set(Object.keys(options.server ?? {}));

  return guard<ConfigOutput<TServer, TClient>>(
    combined,
    serverKeys,
    context.isServer,
    options.server ?? {},
    options.client ?? {},
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
  const serverShape: ZodShape = {};
  const clientShape: ZodShape = {};
  let isServer = true;

  for (const config of configs) {
    const internal = readInternal(config);
    if (!internal) {
      throw new Error(
        'configExtends: every argument must be a config built by createConfig.',
      );
    }
    Object.assign(values, internal.values);
    Object.assign(serverShape, internal.serverShape);
    Object.assign(clientShape, internal.clientShape);
    for (const key of internal.serverKeys) serverKeys.add(key);
    isServer = internal.isServer;
  }

  return guard<MergeConfigs<T>>(
    values,
    serverKeys,
    isServer,
    serverShape,
    clientShape,
  );
}

/**
 * What is overridable about a config, derived from its declared shapes and
 * resolved values (ADR 0033). The one introspection seam this package exposes,
 * and the reason every override name in the repo is *derived* rather than
 * hand-listed — three consumers read it:
 *
 * - each app's build config, to inline the client lane and register its leaf
 *   names in the bundler's `define`/`env` map;
 * - `scripts/check-config-overrides.ts`, to enforce the three lint guards;
 * - the package's own tests.
 *
 * `intolerantPaths` are leaves a same-name variable could never override,
 * because the schema rejects the string an environment hands over (a bare
 * `z.number()`, say). That is a config-authoring bug, so `pnpm lint` fails on it
 * rather than leaving a key that looks overridable and isn't.
 */
export function describeConfig(config: object) {
  const internal = readInternal(config);
  if (!internal) {
    throw new Error(
      'describeConfig: argument must be a config built by createConfig.',
    );
  }
  const { values, serverShape, clientShape } = internal;
  const serverLeaves = shapeLeaves(serverShape, values);
  const clientLeaves = shapeLeaves(clientShape, values);
  return {
    serverKeys: Object.keys(serverShape),
    clientKeys: Object.keys(clientShape),
    serverOverridePaths: serverLeaves.map((leaf) => leaf.path),
    clientOverridePaths: clientLeaves.map((leaf) => leaf.path),
    intolerantPaths: [...serverLeaves, ...clientLeaves]
      .filter((leaf) => !isCoercionTolerant(leaf.schema))
      .map((leaf) => leaf.path),
  };
}
