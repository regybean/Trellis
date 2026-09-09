/**
 * What the packages present in a closure declare about provisioning the local
 * stack — the two answers behind `pnpm dev`, `pnpm preview` and `pnpm infra:up`:
 * which of the compose profiles a closure declares actually need starting, and
 * what values `compose.yaml` interpolates when they do.
 *
 * Both are DISCOVERED from the closure this package already derives, so the
 * caller passes nothing and the answer is whatever packages the checkout
 * contains. Before that, these were functions over five named provider values —
 * Stripe's connection, the models roles, the db/rag/redis profiles — which the
 * root scripts imported from `packages/` by relative path and handed in. Every
 * new slice with infra therefore edited this file and a root script, and a
 * checkout without those five packages could not run `pnpm dev` at all.
 *
 * Ownership is inverted instead: each package declares its own contribution
 * beside its infra metadata, under two manifest keys.
 *
 *   - `acme.provisioning` names a module exporting `PROVISIONING`, a record of
 *     compose-profile name to what this package supplies for it: the `compose`
 *     values, and `needed: false` when the authored configuration turns out not
 *     to want the service after all (real Stripe needs no localstripe
 *     container). Code, because those are authored values a JSON manifest
 *     cannot compute.
 *   - `acme.seeds` maps a profile to a `package.json` script in the same
 *     package, run once that profile is up. A plain string, so a package that
 *     only needs seeding declares no module.
 *
 * Discovery merges what it finds over the profiles the closure declares
 * (`acme.infra`) and nothing else: a contribution to a profile no package in
 * the closure asked for has nothing to provision.
 *
 * The declared values are the AUTHORED development ones and never
 * `process.env` ([@acme/env ADR 0001](../../../packages/platform/env/docs/adr/0001-one-env-factory-per-slice.md) §6) — these decide what to
 * PROVISION, so an operator's override would be the wrong input, and in the
 * compose case a circular one, since `compose.sh` exports this output back into
 * the environment. Keeping that rule is the declaring package's job now; it is
 * the one reading its own profile.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { WorkspacePackage } from './workspace';
import { closurePackages, declaredInfra } from './closure';

/** What one package supplies for one compose profile. */
export interface ProfileProvisioning {
  /**
   * Values `compose.yaml` interpolates, keyed by the `${...}` ref. Numbers are
   * accepted — a port is a number where it is authored — and rendered as text,
   * since the environment carries strings.
   */
  readonly compose?: Readonly<Record<string, string | number>>;
  /**
   * `false` when the authored configuration does not need the service after
   * all, which prunes the profile even though the closure declares it. Absent
   * means needed: declaring nothing about a profile is not a veto.
   */
  readonly needed?: boolean;
}

/** A provisioning module's `PROVISIONING` export, by compose profile name. */
export type ProvisioningDeclaration = Readonly<
  Record<string, ProfileProvisioning>
>;

/** A `package.json` script to run once its profile is up. */
export interface ProfileSeed {
  /** The package declaring it — what `pnpm --filter` is pointed at. */
  readonly package: string;
  readonly script: string;
}

/** A profile the closure declares, merged with what its owners supply. */
export interface DiscoveredProfile {
  readonly name: string;
  /** False when an owner vetoed it; only needed profiles are started. */
  readonly needed: boolean;
  readonly compose: Readonly<Record<string, string>>;
  readonly seeds: readonly ProfileSeed[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const acmeBlock = (pkg: WorkspacePackage) =>
  isRecord(pkg.manifest.acme) ? pkg.manifest.acme : undefined;

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The provisioning module `pkg` declares, as an absolute path, or `undefined`
 * when it declares none.
 */
export function provisioningModule(pkg: WorkspacePackage) {
  const declared = acmeBlock(pkg)?.provisioning;
  return typeof declared === 'string'
    ? path.resolve(pkg.dir, declared)
    : undefined;
}

/**
 * The seeds `pkg` declares, by profile. A non-string entry is ignored, as with
 * `declaredInfra`: validating the field is a checker's job, and this query
 * stays usable while a manifest is wrong.
 */
export function declaredSeeds(pkg: WorkspacePackage) {
  const seeds = acmeBlock(pkg)?.seeds;
  if (!isRecord(seeds)) return {};
  return Object.fromEntries(
    Object.entries(seeds).flatMap(([profile, script]) =>
      typeof script === 'string' ? [[profile, script] as const] : [],
    ),
  );
}

/**
 * The `PROVISIONING` export of one package's module.
 *
 * Loaded with a plain dynamic `import()` of the file URL, so the module is the
 * package's own source in the caller's loader — `tsx` for the root scripts,
 * vitest for a test. A module that is declared but unreadable, or that exports
 * the wrong shape, throws naming the package: a consumer's `pnpm dev` must fail
 * at the thing it asked for rather than quietly provision less.
 */
async function readDeclaration(
  pkg: WorkspacePackage,
  module: string,
): Promise<ProvisioningDeclaration> {
  let imported: unknown;
  try {
    imported = await import(pathToFileURL(module).href);
  } catch (error) {
    throw new Error(
      `${pkg.name}: "acme.provisioning" names ${module}, which could not be loaded: ${reason(error)}`,
    );
  }

  const declaration = isRecord(imported) ? imported.PROVISIONING : undefined;
  if (!isRecord(declaration)) {
    throw new Error(
      `${pkg.name}: ${module} exports no PROVISIONING record of compose profiles`,
    );
  }

  // Rebuilt key by key as it is checked, so what comes back is narrowed by
  // construction rather than asserted to be.
  const contributions: Record<string, ProfileProvisioning> = {};
  for (const [profile, contribution] of Object.entries(declaration)) {
    const at = `${pkg.name}: PROVISIONING.${profile}`;
    if (!isRecord(contribution)) {
      throw new Error(`${at} is not a record of what it supplies`);
    }

    const needed = contribution.needed;
    if (needed !== undefined && typeof needed !== 'boolean') {
      throw new Error(`${at}.needed is not a boolean`);
    }

    const declaredCompose = contribution.compose;
    if (declaredCompose !== undefined && !isRecord(declaredCompose)) {
      throw new Error(`${at}.compose is not a record of compose values`);
    }

    const compose: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(declaredCompose ?? {})) {
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new Error(
          `${at}.compose.${key} is ${JSON.stringify(value)}, which is no compose value`,
        );
      }
      compose[key] = value;
    }

    contributions[profile] = { needed, compose };
  }

  return contributions;
}

/** One profile under construction, before it is frozen into the result. */
interface Merging {
  needed: boolean;
  compose: Record<string, string>;
  seeds: ProfileSeed[];
}

/**
 * What `packages` declare they need provisioned: the profiles their `acme.infra`
 * names, each carrying the compose values, the prune verdict and the seeds the
 * packages supply for it.
 *
 * Sorted by profile name (`declaredInfra`'s order), and each profile's seeds in
 * package-name order, so the answer is stable whatever order the closure came
 * back in.
 *
 * @throws when a declared module is unloadable, or when two packages supply the
 * same compose value differently — a silent winner there provisions a stack
 * neither package described.
 */
export async function discoverProfiles(
  packages: readonly WorkspacePackage[],
): Promise<DiscoveredProfile[]> {
  const candidates = declaredInfra(packages);
  const merged = new Map<string, Merging>(
    candidates.map((name) => [name, { needed: true, compose: {}, seeds: [] }]),
  );
  /** Which package supplied each compose value, for the conflict message. */
  const suppliers = new Map<string, WorkspacePackage>();

  const declared = packages.flatMap((pkg) => {
    const module = provisioningModule(pkg);
    return module ? [{ pkg, module }] : [];
  });
  // Loaded together rather than in sequence: each is an independent import.
  const declarations = await Promise.all(
    declared.map(async ({ pkg, module }) => ({
      pkg,
      declaration: await readDeclaration(pkg, module),
    })),
  );

  for (const pkg of packages) {
    for (const [profile, script] of Object.entries(declaredSeeds(pkg))) {
      merged.get(profile)?.seeds.push({ package: pkg.name, script });
    }
  }

  for (const { pkg, declaration } of declarations) {
    for (const [profile, contribution] of Object.entries(declaration)) {
      const target = merged.get(profile);
      if (!target) continue; // nothing in this closure asked for the service
      if (contribution.needed === false) target.needed = false;

      for (const [key, value] of Object.entries(contribution.compose ?? {})) {
        const supplied = String(value);
        const supplier = suppliers.get(key);
        if (supplier && target.compose[key] !== supplied) {
          throw new Error(
            `${pkg.name} and ${supplier.name} both supply the compose value ${key}, with different values`,
          );
        }
        suppliers.set(key, pkg);
        target.compose[key] = supplied;
      }
    }
  }

  return candidates.map((name) => {
    const { needed, compose, seeds } = merged.get(name) ?? {
      needed: true,
      compose: {},
      seeds: [],
    };
    return { name, needed, compose, seeds };
  });
}

/** Discovery over the transitive closure of `names` — what the scripts call. */
export async function closureProvisioning(
  root: string,
  names: readonly string[],
) {
  return discoverProfiles(closurePackages(root, names));
}

/**
 * The profiles to start: everything discovered that no owner vetoed. Candidate
 * order is preserved, so the list stays sorted.
 */
export function neededProfiles(profiles: readonly DiscoveredProfile[]) {
  return profiles.filter((profile) => profile.needed).map(({ name }) => name);
}

/** The seeds of the profiles that will be started, in profile order. */
export function neededSeeds(profiles: readonly DiscoveredProfile[]) {
  return profiles
    .filter((profile) => profile.needed)
    .flatMap(({ seeds }) => seeds);
}

/**
 * Every value `compose.yaml` interpolates, merged across the discovered
 * profiles. `scripts/resolve-compose-env.ts` renders it and `scripts/compose.sh`
 * exports the result, where compose substitutes the `${...}` refs at parse time.
 *
 * Pruned profiles contribute too: compose parses every service in the file
 * whatever the active profile set is, so a value it interpolates is wanted even
 * where the service will not be started. A profile nothing supplies values for
 * simply contributes none — under discovery, absent is absent rather than fatal.
 */
export function composeEnvironment(profiles: readonly DiscoveredProfile[]) {
  return Object.fromEntries(
    profiles.flatMap(({ compose }) => Object.entries(compose)),
  );
}
