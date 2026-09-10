// Which compose infra profiles the given apps need, which seeds those profiles
// ask for, and — with `--names` — which apps a set of tokens names.
//
// Every answer comes from `@acme/workspace-graph`, DISCOVERED from the packages
// the checkout actually contains: the union of `acme.infra` over each app's
// transitive closure is the candidate set, and the packages in that closure
// declare what to do with each candidate — the compose values it needs, whether
// their authored configuration wants the service at all (`acme.provisioning`),
// and the seed to run once it is up (`acme.seeds`).
//
// So this file names no package, no profile and no seed. Adding an app, a slice
// with infra, or a slice with a seed needs no change here, and a checkout
// without any of them resolves an empty set rather than failing on an import
// (`@acme/workspace-graph` is reached by relative path because the root
// workspace declares no `@acme/*` dependency; it needs no build).
//
// Run via `pnpm exec tsx` (not `node`) so the TS config imports resolve, both
// here and in the provisioning modules discovery loads.
//
// Usage:  resolve-infra.ts [--names|--seeds] [app ...]
//         no app args => every app under apps/*
//         app may be a full name (@acme/web) or short (web).
// Output: default   comma-separated profile list (possibly empty)
//         --names   one canonical @acme/* app name per line
//         --seeds   one `<package>\t<script>` line per seed of a started profile
import {
  closureProvisioning,
  neededProfiles,
  neededSeeds,
  repoRoot,
  resolveToken,
  workspaceApps,
} from "../tooling/workspace-graph/src/index";

const root = repoRoot();
const apps = workspaceApps(root);

// Keep the script's own prefix on the failure: it is what the operator sees.
const toAppName = (token: string) => {
  try {
    return resolveToken(token, apps, "app").name;
  } catch (error) {
    throw new Error(
      `resolve-infra: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const argv = process.argv.slice(2);
// `--names`: print the resolved canonical @acme/* app names and exit — used by
// dev.sh, since turbo's -F needs full names, not short ones. `--seeds`: print
// the seeds the started profiles declare, for dev.sh / infra-up.sh to run.
const namesMode = argv.includes("--names");
const seedsMode = argv.includes("--seeds");
const tokens = argv.filter((a) => a !== "--names" && a !== "--seeds");

const targets =
  tokens.length > 0 ? tokens.map(toAppName) : apps.map((app) => app.name);

if (namesMode) {
  process.stdout.write(targets.join("\n"));
  process.exit(0);
}

// Discovery loads each declaring package's module, so the answer is a promise.
// Wrapped rather than awaited at the top level because the root package is CJS
// (no `"type": "module"`), which esbuild refuses to emit top-level await into. A
// rejection is left unhandled deliberately: node prints it and exits non-zero,
// which is exactly what a caller of this script needs to see.
void (async () => {
  const discovered = await closureProvisioning(root, targets);

  if (seedsMode) {
    const seeds = neededSeeds(discovered).map(
      (seed) => `${seed.package}\t${seed.script}\n`,
    );
    process.stdout.write(seeds.join(""));
  } else {
    process.stdout.write(neededProfiles(discovered).join(","));
  }
})();
