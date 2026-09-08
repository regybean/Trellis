// Which compose infra profiles the given apps need — and, with `--names`, which
// apps a set of tokens names. Both answers come from `@acme/workspace-graph`;
// this file exists to hand it the slices' authored development profiles.
//
// The graph yields the CANDIDATE set: the union of `acme.infra` over each app's
// transitive workspace closure, so adding an app needs no change here and an app
// whose closure declares nothing starts no infra (ADR 0009). The authored
// development profiles then PRUNE it (`pruneInfra`, @acme/env ADR 0001 §6): the
// `billing` (localstripe) profile goes unless the authored Stripe connection is
// localstripe, and `ollama` goes unless a models role runs on ollama.
//
// The `development-profile.ts` modules are imported rather than each slice's
// `env.ts`: this decides what to PROVISION, so it wants the values the repo
// authors and never an operator's override, and those modules execute no
// `createEnv` call.
//
// Importing them by RELATIVE PATH is why the decisions moved into the package
// while this file stayed in `scripts/`. Root scripts carry no boundary tag, so
// reaching into `packages/*` is legal here; inside a `tooling` package the same
// import would be a tooling→platform/shared/feature edge, which the layer rules
// forbid outright. `@acme/workspace-graph` is reached the same way — the root
// workspace declares no `@acme/*` dependency — and it needs no build.
//
// Run via `pnpm exec tsx` (not `node`) so the TS config imports resolve,
// mirroring scripts/resolve-compose-env.ts.
//
// Usage:  resolve-infra.ts [app ...]      (no args => every app under apps/*)
//         app may be a full name (@acme/nextjs) or short (nextjs).
// Output: comma-separated profile list (possibly empty) on stdout.
import { BILLING_DEVELOPMENT_PROFILE } from "../packages/features/billing/src/development-profile";
import { MODELS_DEVELOPMENT_PROFILE } from "../packages/shared/models/src/development-profile";
import {
  closureInfra,
  pruneInfra,
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
// `--names`: print the resolved canonical @acme/* app names (one per line) and
// exit — used by dev.sh, since turbo's -F needs full names, not short ones.
const namesMode = argv.includes("--names");
const tokens = argv.filter((a) => a !== "--names");

const targets =
  tokens.length > 0 ? tokens.map(toAppName) : apps.map((app) => app.name);

if (namesMode) {
  process.stdout.write(targets.join("\n"));
  process.exit(0);
}

const profiles = pruneInfra(closureInfra(root, targets), {
  stripe: BILLING_DEVELOPMENT_PROFILE.STRIPE_CONNECTION,
  models: MODELS_DEVELOPMENT_PROFILE,
});

process.stdout.write(profiles.join(","));
