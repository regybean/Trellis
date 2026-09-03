// Resolve the set of compose infra profiles required by the given apps from the
// workspace dependency graph — the single source of truth, so adding an app
// needs no change here.
//
// Each package declares the infra it actually touches in its package.json under
// `acme.infra` (e.g. ["postgres"]). An app's required infra is the UNION of
// `acme.infra` over its transitive workspace closure. Nothing is assumed on:
// an app whose closure declares nothing starts no infra.
//
// The graph yields a CANDIDATE set; the slices' authored development profiles
// then PRUNE it for services that are only needed under a given configuration
// (@acme/env ADR 0001 §6), NOT process.env:
//   - `billing` (localstripe) is dropped unless the authored Stripe connection is
//     `localstripe` (real Stripe needs no local container). Reads
//     `BILLING_DEVELOPMENT_PROFILE`'s `STRIPE_CONNECTION` discriminated union.
//   - `ollama` is dropped unless the chat or embed role's provider is `ollama`.
//     Reads the role variants on `MODELS_DEVELOPMENT_PROFILE`.
// The `development-profile.ts` modules are imported rather than each slice's
// `env.ts`: this decides what to PROVISION, so it wants the authored values and
// never an operator's override, and those modules execute no `createEnv` call.
// Run via `pnpm exec tsx` (not `node`) so the TS config imports resolve,
// mirroring scripts/resolve-compose-env.ts.
//
// Usage:  resolve-infra.ts [app ...]      (no args => every app under apps/*)
//         app may be a full name (@acme/nextjs) or short (nextjs).
// Output: comma-separated profile list (possibly empty) on stdout.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BILLING_DEVELOPMENT_PROFILE } from "../packages/features/billing/src/development-profile";
import { MODELS_DEVELOPMENT_PROFILE } from "../packages/shared/models/src/development-profile";

// `import.meta.dirname` is undefined under tsx's CJS transform; derive it from
// the module URL, which tsx shims.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readPkg = (dir: string) =>
  JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));

// Every workspace package under apps/* — the default "run everything" set.
const appDirs = readdirSync(path.join(root, "apps"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => path.join(root, "apps", e.name))
  .filter((dir) => {
    try {
      readPkg(dir);
      return true;
    } catch {
      return false;
    }
  });
const appsByName = new Map(appDirs.map((dir) => [readPkg(dir).name, dir]));

// Resolve a CLI token (full or short name) to a workspace app name.
const toAppName = (token: string) => {
  if (appsByName.has(token)) return token;
  const qualified = `@acme/${token}`;
  if (appsByName.has(qualified)) return qualified;
  const byDir = appDirs.find((dir) => path.basename(dir) === token);
  if (byDir) return readPkg(byDir).name;
  throw new Error(`resolve-infra: unknown app "${token}"`);
};

const argv = process.argv.slice(2);
// `--names`: print the resolved canonical @acme/* app names (one per line) and
// exit — used by dev.sh, since turbo's -F needs full names, not short ones.
const namesMode = argv.includes("--names");
const tokens = argv.filter((a) => a !== "--names");

const targets =
  tokens.length > 0 ? tokens.map(toAppName) : [...appsByName.keys()];

if (namesMode) {
  process.stdout.write(targets.join("\n"));
  process.exit(0);
}

// One pnpm call: the union of every target's transitive workspace closure.
const filters = targets.flatMap((name) => ["--filter", `${name}...`]);
const raw = execFileSync(
  "pnpm",
  [...filters, "ls", "--only-projects", "--depth", "-1", "--json"],
  { cwd: root, encoding: "utf8" },
);
const projects = JSON.parse(raw);

const profiles = new Set<string>();
for (const proj of projects) {
  const infra = readPkg(proj.path).acme?.infra;
  if (Array.isArray(infra)) for (const p of infra) profiles.add(p);
}

// Profile prunes (see header). Infra is a local dev/test concern, so both read
// the development profile — the same source `scripts/resolve-compose-env.ts`
// reads.
if (BILLING_DEVELOPMENT_PROFILE.STRIPE_CONNECTION.mode !== "localstripe") {
  profiles.delete("billing");
}
const { MODELS_CHAT: chat, MODELS_EMBED: embed } = MODELS_DEVELOPMENT_PROFILE;
if (chat.provider !== "ollama" && embed.provider !== "ollama") {
  profiles.delete("ollama");
}

process.stdout.write([...profiles].sort().join(","));
