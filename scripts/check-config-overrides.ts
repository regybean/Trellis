// Config env-override gate (ADR 0033). Every non-sensitive config value is
// overridable by an environment variable of the same name, which puts config key
// names and `process.env` in one shared namespace. Three things can silently go
// wrong there, and none of them is something a test would catch — so they are
// lint failures:
//
//   1. COLLISION — a config key that shadows a slice's secret-env key, or one of
//      the `{ APP_ENV, NEXT_PUBLIC_WEBAPP }` selectors. Two owners for one
//      variable: setting it would either leak a secret slot into the client
//      bundle or silently retarget a profile/schema/namespace.
//   2. INTOLERANT LEAF — an overridable scalar whose schema rejects the string an
//      environment hands over (a bare `z.number()`). The key looks overridable
//      and isn't; the failure only shows up when someone tries it in production.
//   3. LITERAL `__` — a config key containing the path separator, which makes
//      `KEY__field` ambiguous between a nested path and a top-level name.
//
// It also checks that every *client*-overridable leaf name is registered in
// `turbo.json` `globalEnv`. Client config is inlined at build time, so an
// unregistered name means turbo replays a cached build and quietly ships the old
// value.
//
// Config modules are DISCOVERED, never listed: a new slice's `config.ts` is
// covered the moment it exists.
//
// Run via `pnpm exec tsx` (not `node`) so the TS config imports resolve,
// mirroring scripts/resolve-infra.ts.
//
// Usage:  check-config-overrides.ts     (exit 1 on any violation)
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ConfigContext } from "../packages/platform/config/src/create-config";
import {
  describeConfig,
  isConfig,
} from "../packages/platform/config/src/create-config";
import { CLIENT_OVERRIDES_VAR } from "../packages/platform/config/src/overrides";

// `import.meta.dirname` is undefined under tsx's CJS transform; derive it from
// the module URL, which tsx shims.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The `process.env` selectors (ADR 0026 §1). Config never owns these names: they
 * pick the profile and the app identity, and are read pre-composition — a config
 * key of the same name would be resolved *by* the thing it claims to set.
 */
const SELECTORS = ["APP_ENV", "NEXT_PUBLIC_WEBAPP"];

const LAYERS = ["packages/platform", "packages/shared", "packages/features"];

/** Every `src/<name>.ts` across the runtime layers — the discovery primitive. */
function sliceModules(name: string) {
  return LAYERS.flatMap((layer) => {
    const dir = path.join(root, layer);
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name, "src", `${name}.ts`))
      .filter((file) => {
        try {
          readFileSync(file);
          return true;
        } catch {
          return false;
        }
      });
  });
}

/**
 * Every key validated by a `createEnv` shape, across every `env.ts` in the repo.
 *
 * Read as text rather than by importing: an `env.ts` validates against the real
 * `process.env` on import and a t3-env object exposes values, not its declared
 * shape — neither is usable from a lint gate. The declaration form is uniform
 * (`KEY: z.…`), and `runtimeEnv` entries (`KEY: process.env.KEY`) deliberately
 * don't match, so this reads exactly the validated set.
 */
function envKeys() {
  const files = [
    ...sliceModules("env"),
    ...readdirSync(path.join(root, "apps"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, "apps", entry.name, "src", "env.ts")),
  ];
  const keys = new Map<string, string>();
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(/^\s+([A-Z][A-Z0-9_]*):\s*z\./gm)) {
      const [, key] = match;
      if (key) keys.set(key, path.relative(root, file));
    }
  }
  return keys;
}

/** A config factory: takes the injected context, returns a guarded config. */
type ConfigFactory = (context: ConfigContext) => object;

const isFactory = (value: unknown): value is ConfigFactory =>
  typeof value === "function" && value.length === 1;

/**
 * Build every discovered slice config against the base profile and describe it.
 * The profile choice is irrelevant — the declared shapes are what's checked, and
 * they don't vary by deploy target.
 */
async function describeEverySliceConfig() {
  const context: ConfigContext = { appEnv: "development", isServer: true };
  const described = [];
  for (const file of sliceModules("config")) {
    const relative = path.relative(root, file);
    const module: unknown = await import(file);
    if (typeof module !== "object" || module === null) continue;
    for (const [name, exported] of Object.entries(module)) {
      if (!name.endsWith("Config") || !isFactory(exported)) continue;
      // The name convention narrows the candidates; only the internal handle
      // proves one — `toBillingClientConfig` matches both name and arity.
      const built = exported(context);
      if (!isConfig(built)) continue;
      described.push({
        slice: relative,
        factory: name,
        ...describeConfig(built),
      });
    }
  }
  return described;
}

function globalEnv(): string[] {
  const turbo: unknown = JSON.parse(
    readFileSync(path.join(root, "turbo.json"), "utf8"),
  );
  if (typeof turbo !== "object" || turbo === null || !("globalEnv" in turbo)) {
    return [];
  }
  const { globalEnv: declared } = turbo;
  return Array.isArray(declared) ? declared.filter((e) => typeof e === 'string') : []; // prettier-ignore
}

async function main() {
  const configs = await describeEverySliceConfig();
  const env = envKeys();
  const declaredGlobalEnv = new Set(globalEnv());
  const problems = collectProblems(configs, env, declaredGlobalEnv);

  if (problems.length > 0) {
    console.error("✖ config override gate (ADR 0033)\n");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(`\n${problems.length} problem(s).`);
    process.exit(1);
  }

  const leafCount = configs.reduce(
    (total, config) =>
      total +
      config.serverOverridePaths.length +
      config.clientOverridePaths.length,
    0,
  );
  console.log(
    `✔ config override gate: ${configs.length} config(s), ${leafCount} overridable leaf/leaves.`,
  );
}

type DescribedConfigs = Awaited<ReturnType<typeof describeEverySliceConfig>>;

function collectProblems(
  configs: DescribedConfigs,
  env: Map<string, string>,
  declaredGlobalEnv: ReadonlySet<string>,
) {
  const problems: string[] = [];

  if (configs.length === 0) {
    problems.push(
      "no config factories were discovered — the gate would pass vacuously",
    );
  }

  for (const config of configs) {
    const where = `${config.slice} (${config.factory})`;

    for (const key of [...config.serverKeys, ...config.clientKeys]) {
      if (key.includes("__")) {
        problems.push(
          `${where}: config key "${key}" contains the "__" override separator ` +
            `— "KEY__field" would be ambiguous between this key and a path.`,
        );
      }
      if (SELECTORS.includes(key)) {
        problems.push(
          `${where}: config key "${key}" collides with a process.env selector ` +
            `— selectors pick the profile/namespace and are read ` +
            `pre-composition, so config can never own that name (ADR 0026 §1).`,
        );
      }
      const owner = env.get(key);
      if (owner) {
        problems.push(
          `${where}: config key "${key}" collides with the env key validated ` +
            `in ${owner} — one variable cannot be both a secret slot and an ` +
            `overridable config value. Rename the config key.`,
        );
      }
    }

    for (const leaf of config.intolerantPaths) {
      problems.push(
        `${where}: overridable leaf "${leaf}" rejects a string, so a same-name ` +
          `environment variable could never set it. Use z.coerce.number() / ` +
          `coercedBoolean() from @acme/config.`,
      );
    }

    for (const leaf of config.clientOverridePaths) {
      if (!declaredGlobalEnv.has(leaf)) {
        problems.push(
          `${where}: client-overridable leaf "${leaf}" is missing from ` +
            `turbo.json globalEnv. Client config is inlined at build, so ` +
            `without it turbo replays a cached build and ships the old value.`,
        );
      }
    }
  }

  const hasClientLeaves = configs.some(
    (config) => config.clientOverridePaths.length > 0,
  );
  if (hasClientLeaves && !declaredGlobalEnv.has(CLIENT_OVERRIDES_VAR)) {
    problems.push(
      `turbo.json globalEnv is missing "${CLIENT_OVERRIDES_VAR}" — the ` +
        `build-injected literal carrying the client override lane.`,
    );
  }

  return problems;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
