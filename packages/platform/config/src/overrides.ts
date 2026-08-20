import { z } from 'zod/v4';

/**
 * The env-override layer (ADR 0033). Any non-sensitive config value is
 * overridable by an environment variable of the **same name**, so an image can
 * be built once and retuned per deploy without editing a profile. Precedence:
 *
 *   default profile → `APP_ENV` overlay → env override → validate
 *
 * This module is pure: it never reads `process.env`. The bag arrives from the
 * sanctioned `env.ts` edge, exactly as `appEnv` does (ADR 0026 §4).
 */

/**
 * Path separator inside an override variable name. A nested value is addressed
 * by joining its path with `__` down to a **scalar leaf** —
 * `CREDIT_LIMITS__Pro`, `chat__provider`, `REGIONS__0__id`. A config key may
 * never contain a literal `__` itself (enforced by `pnpm lint`), so the split is
 * unambiguous.
 */
export const OVERRIDE_SEPARATOR = '__';

/**
 * The single build-injected variable carrying the **client** override lane.
 *
 * Client config is inlined at build and frozen in the image, so its overrides
 * must be sampled while the bundler runs. Per-leaf `process.env.<KEY>` reads
 * can't be assembled generically in browser code (neither Next nor Vite lets
 * client code enumerate `process.env` — they rewrite individual member
 * expressions), so each app's build config collects the client lane in Node and
 * injects it as one frozen JSON literal that the app's `env.ts` reads back by
 * this exact name. The per-leaf names are injected alongside it (see
 * {@link clientOverrideBuildEnv}) and listed in `turbo.json` `globalEnv`, which
 * is what makes a changed client override bust the build cache.
 */
export const CLIENT_OVERRIDES_VAR = 'ACME_CONFIG_CLIENT_OVERRIDES';

/** A raw environment bag — `process.env`, or a literal in a test. */
export type OverrideBag = Readonly<Record<string, string | undefined>>;

/**
 * The two override lanes, split by **when they can be sampled** — the hard
 * limit of this mechanism (ADR 0033 §3):
 *
 * - `server` — sampled from `process.env` at **runtime**. Genuine
 *   build-once-deploy-anywhere: change the var, restart, done.
 * - `client` — sampled at **build time** and frozen into the bundle. Setting the
 *   same var on a deployed container has no effect, because the value was
 *   already inlined.
 *
 * Keeping them as separate bags is what enforces the limit structurally:
 * `createConfig` applies the server bag only to `server`-shape paths and the
 * client bag only to `client`-shape paths. Were it one flat bag, a runtime var
 * would silently override a client key during server rendering and disagree with
 * the frozen browser value — a hydration mismatch by construction.
 */
export interface ConfigOverrides {
  server?: OverrideBag;
  client?: OverrideBag;
}

type Shape = Record<string, z.ZodType>;
type Record_ = Record<string, unknown>;

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

const isRecord = (value: unknown): value is Record_ =>
  typeof value === 'object' && value !== null && !isArray(value);

/**
 * Read zod v4's internal schema definition. `_zod.def` is zod's own documented
 * introspection surface (it is what `z.toJSONSchema` walks); there is no public
 * accessor for a schema's children, and this package needs them to derive
 * override paths and to prove coercion-tolerance.
 */
function schemaDef(schema: z.ZodType) {
  return (
    schema as unknown as {
      _zod: {
        def: {
          type: string;
          shape?: Shape;
          options?: z.ZodType[];
          element?: z.ZodType;
          valueType?: z.ZodType;
          innerType?: z.ZodType;
        };
      };
    }
  )._zod.def;
}

/** Wrappers that change neither how a value is addressed nor how it coerces. */
const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'nonoptional',
  'readonly',
  'catch',
]);

/** Peel those wrappers to reach the schema that actually shapes the value. */
function unwrap(schema: z.ZodType): z.ZodType {
  const def = schemaDef(schema);
  return def.innerType && WRAPPERS.has(def.type)
    ? unwrap(def.innerType)
    : schema;
}

const join = (path: string, segment: string) =>
  path === '' ? segment : `${path}${OVERRIDE_SEPARATOR}${segment}`;

/**
 * Does this leaf accept the *string* an environment variable hands over?
 *
 * Proven behaviourally rather than by an allow-list of schema types: parse a
 * representative numeric-looking string and look for a root `invalid_type`
 * issue. `z.string()` / `z.url()` / `z.enum()` / `z.literal()` / `z.coerce.*` /
 * `z.stringbool()` all get past the type gate (a later format or range failure
 * is fine — the *type* was accepted); bare `z.number()` / `z.boolean()` /
 * `z.date()` do not, and would make the key un-overridable.
 *
 * The probe is `'1'`, not a word: `z.coerce.number()` turns a non-numeric string
 * into `NaN`, which zod reports as `invalid_type` — a word would libel every
 * coerced number as intolerant.
 */
export function isCoercionTolerant(schema: z.ZodType) {
  const result = schema.safeParse('1');
  if (result.success) return true;
  return !result.error.issues.some(
    (issue) => issue.code === 'invalid_type' && issue.path.length === 0,
  );
}

interface Leaf {
  path: string;
  schema: z.ZodType;
}

/**
 * Every override-addressable scalar leaf under one declared key, as `__`-joined
 * paths. Containers recurse; anything else is a leaf.
 *
 * `values` (the resolved config) supplies the *instance* structure that a schema
 * alone can't: how many elements an array has, and which keys a `z.record()`
 * carries. A union recurses into **every** variant, so the leaf names needed to
 * flip it are all addressable even though only one variant is live.
 */
function leaves(schema: z.ZodType, value: unknown, path: string): Leaf[] {
  const inner = unwrap(schema);
  return containerLeaves(inner, value, path) ?? [{ path, schema: inner }];
}

/** Recurse into a container schema, or `undefined` when this is a leaf. */
function containerLeaves(schema: z.ZodType, value: unknown, path: string) {
  const def = schemaDef(schema);
  switch (def.type) {
    case 'object': {
      return objectLeaves(def.shape, value, path);
    }
    case 'union': {
      return unionLeaves(def.options, value, path);
    }
    case 'array': {
      return arrayLeaves(def.element, value, path);
    }
    case 'record': {
      return recordLeaves(def.valueType, value, path);
    }
    default: {
      return;
    }
  }
}

function objectLeaves(shape: Shape | undefined, value: unknown, path: string) {
  if (!shape) return;
  return Object.entries(shape).flatMap(([key, child]) =>
    leaves(child, isRecord(value) ? value[key] : undefined, join(path, key)),
  );
}

const CONTAINERS = new Set(['object', 'union', 'array', 'record']);

/**
 * Every variant's leaves, deduped — flipping a union needs all of them
 * addressable, not just the live variant's.
 *
 * A union of plain scalars (`coercedBoolean()`'s `boolean | stringbool`) is not
 * a container at all: it is one leaf whose schema is the whole union. Recursing
 * into it would dedupe down to whichever branch came first and then judge the
 * leaf's coercion-tolerance by that branch alone — reading `z.boolean() |
 * z.stringbool()` as intolerant.
 */
function unionLeaves(
  options: z.ZodType[] | undefined,
  value: unknown,
  path: string,
) {
  if (!options) return;
  const nested = options.some((option) =>
    CONTAINERS.has(schemaDef(unwrap(option)).type),
  );
  if (!nested) return;
  const seen = new Map<string, Leaf>();
  for (const option of options) {
    for (const leaf of leaves(option, value, path)) {
      if (!seen.has(leaf.path)) seen.set(leaf.path, leaf);
    }
  }
  return [...seen.values()];
}

function arrayLeaves(
  element: z.ZodType | undefined,
  value: unknown,
  path: string,
) {
  if (!element) return;
  if (!isArray(value)) return [];
  return value.flatMap((item, index) =>
    leaves(element, item, join(path, String(index))),
  );
}

function recordLeaves(
  valueType: z.ZodType | undefined,
  value: unknown,
  path: string,
) {
  if (!valueType) return;
  if (!isRecord(value)) return [];
  return Object.keys(value).flatMap((key) =>
    leaves(valueType, value[key], join(path, key)),
  );
}

/** Every addressable leaf of a whole shape, given its resolved values. */
export function shapeLeaves(shape: Shape, values: unknown) {
  return Object.entries(shape).flatMap(([key, schema]) =>
    leaves(schema, isRecord(values) ? values[key] : undefined, key),
  );
}

/**
 * Turn a flat env bag into a nested patch object, keeping only the entries whose
 * first segment names a key this shape actually declares — the whole of
 * `process.env` can be handed in and nothing foreign is picked up.
 *
 * An unset or empty value is skipped, so `FOO=` falls through to the profile
 * value rather than overriding it with `''` (which `z.coerce.number()` would
 * happily read as `0`).
 *
 * Only the *first* segment is validated. Deeper segments are addressed
 * structurally and left to zod: a path into a live variant patches it, and a
 * path belonging to a variant that is no longer selected is stripped at parse
 * time — the same object-strip that lets a profile overlay flip a union.
 */
export function overridePatch(shape: Shape, bag: OverrideBag) {
  const patch: Record_ = {};
  for (const [name, raw] of Object.entries(bag)) {
    if (raw === undefined || raw === '') continue;
    const segments = name.split(OVERRIDE_SEPARATOR);
    const [head] = segments;
    if (head === undefined || !(head in shape)) continue;
    if (segments.includes('')) continue;

    const leaf = segments.at(-1) ?? head;
    let cursor = patch;
    for (const segment of segments.slice(0, -1)) {
      if (!isRecord(cursor[segment])) cursor[segment] = {};
      const child = cursor[segment];
      if (!isRecord(child)) break;
      cursor = child;
    }
    cursor[leaf] = raw;
  }
  return patch;
}

/**
 * Deep-merge a patch over the profile-merged values.
 *
 * Arrays are patched **by position** — `REGIONS__1__id=x` replaces element 1's
 * `id` and leaves element 0 alone. This is the one documented divergence from
 * profile merging, where an array *replaces* wholesale (`mergeArrays: false`,
 * ADR 0026 §2): index addressing has no way to express "and drop the rest", so
 * the two layers necessarily differ. See ADR 0033 §4.
 */
export function mergeOverride(base: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch;
  if (isArray(base)) {
    const next = [...base];
    for (const [key, value] of Object.entries(patch)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0) continue;
      next[index] = mergeOverride(next[index], value);
    }
    return next;
  }
  if (!isRecord(base)) return patch;
  const next: Record_ = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    next[key] = mergeOverride(next[key], value);
  }
  return next;
}

/** Apply a shape's override lane to its profile-merged values. */
export function applyOverrides(
  shape: Shape | undefined,
  values: unknown,
  bag: OverrideBag | undefined,
) {
  if (!shape || !bag) return values;
  return mergeOverride(values, overridePatch(shape, bag));
}

const clientOverridesSchema = z.record(z.string(), z.string());

/**
 * Read the build-injected client lane back out of {@link CLIENT_OVERRIDES_VAR}.
 * Tolerant by design — an absent or malformed literal means "no client
 * overrides", never a boot failure: the value is baked by a build config, so a
 * bad one is a tooling bug that must not take the app down.
 */
export function readClientOverrides(raw: string | undefined): OverrideBag {
  if (raw === undefined || raw === '') return {};
  try {
    const parsed = clientOverridesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
